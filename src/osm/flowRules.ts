import { armsAt, type Arm } from './lanes';
import { direction, isDrivable } from './tags';
import type { OsmDoc, OsmWay } from './types';
import type { LonLat } from './geo';

/**
 * Checks of the traffic flows against the traffic rules, run with the rest of the validation on
 * every edit, so they follow the graph as it changes:
 *
 * - head-on: one-way roads that all drive into a node (or all out of it): the flows meet head on
 *   and nobody can leave, or nobody can get there. Typically a direction flipped by mistake.
 * - wrong U-turn: a short link between the two carriageways of a road that takes traffic round to
 *   the right onto the other one. In right-hand traffic a U-turn is made to the left (ПДД 8.8); a
 *   right-hand one means the link, or the carriageways, point the wrong way.
 */

export type FlowRuleKind = 'head-on' | 'wrong-uturn';
export type FlowFix = { type: 'flip'; wayId: string } | { type: 'oneway'; wayId: string; value: 'yes' | '-1' };

export interface FlowIssue {
  readonly id: string;
  readonly kind: FlowRuleKind;
  readonly message: string;
  readonly at: LonLat;
  readonly wayIds: readonly string[];
  readonly nodeIds: readonly string[];
  readonly fix?: FlowFix;
}

/** A link longer than this is a road of its own, not a U-turn between carriageways, metres. */
const UTURN_LINK_MAX_M = 80;
/** Carriageways whose directions differ by at least this much run opposite ways, degrees. */
const OPPOSITE_DEG = 140;

const M_PER_DEG = (Math.PI / 180) * 6_371_000;
type V = [number, number];

const lonLat = (doc: OsmDoc, id: string): LonLat => [doc.nodes[id].lon, doc.nodes[id].lat];
const name = (w: OsmWay) => w.tags.name || w.tags.highway || 'дорога';

function local(doc: OsmDoc, lat0: number) {
  const k = Math.cos((lat0 * Math.PI) / 180);
  return (id: string): V => [doc.nodes[id].lon * M_PER_DEG * k, doc.nodes[id].lat * M_PER_DEG];
}

function lengthM(doc: OsmDoc, w: OsmWay): number {
  const to = local(doc, doc.nodes[w.refs[0]].lat);
  return w.refs.slice(1).reduce((s, r, i) => {
    const [a, b] = [to(w.refs[i]), to(r)];
    return s + Math.hypot(b[0] - a[0], b[1] - a[1]);
  }, 0);
}

const isOneway = (w: OsmWay) => direction(w.tags) !== 'both';
/** A carriageway of a road: a ramp (`*_link`) is not one, it joins roads rather than runs along them. */
const isCarriageway = (w: OsmWay) => isOneway(w) && !(w.tags.highway ?? '').endsWith('_link');
/** A link between carriageways crosses them: it runs at least this far off their direction, degrees. */
const ACROSS_MIN_DEG = 35;

/** Junction-wise flows: nodes where one-way roads all come in or all go out. */
function headOn(doc: OsmDoc, ways: readonly OsmWay[]): FlowIssue[] {
  const nodes = new Set<string>();
  ways.forEach((w) => w.refs.forEach((r) => nodes.add(r)));
  const out: FlowIssue[] = [];
  for (const id of nodes) {
    const arms = armsAt(doc, id);
    if (arms.length < 2) continue;
    const lanesIn = arms.reduce((s, a) => s + a.lanesIn, 0);
    const lanesOut = arms.reduce((s, a) => s + a.lanesOut, 0);
    if (lanesIn > 0 && lanesOut > 0) continue;
    const wayIds = [...new Set(arms.map((a) => a.wayId))];
    if (wayIds.length < 2) continue;
    const names = wayIds.map((w) => name(doc.ways[w])).filter((n, i, all) => all.indexOf(n) === i).join(', ');
    // Flipping the shortest road is usually the fix: a link or a block drawn the wrong way.
    const shortest = [...wayIds].sort((a, b) => lengthM(doc, doc.ways[a]) - lengthM(doc, doc.ways[b]))[0];
    out.push({
      id: `head-on:${id}`, kind: 'head-on', at: lonLat(doc, id), wayIds, nodeIds: [id], fix: { type: 'flip', wayId: shortest },
      message: lanesIn > 0
        ? `Встречные потоки упираются друг в друга (${names}): все односторонние дороги ведут в узел, выехать из него нельзя`
        : `Из узла все односторонние дороги ведут наружу (${names}): въехать сюда нельзя ни с одной стороны`,
    });
  }
  return out;
}

/** Heading of travel along a one-way way at one of its nodes, as a unit vector. */
function heading(doc: OsmDoc, w: OsmWay, at: string): V | null {
  const i = w.refs.indexOf(at);
  if (i < 0) return null;
  const to = local(doc, doc.nodes[at].lat);
  const [a, b] = i < w.refs.length - 1 ? [to(w.refs[i]), to(w.refs[i + 1])] : [to(w.refs[i - 1]), to(w.refs[i])];
  const sign = direction(w.tags) === 'backward' ? -1 : 1;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [((b[0] - a[0]) / len) * sign, ((b[1] - a[1]) / len) * sign];
}

/** The one-way carriageway through a node other than `skip`, if there is exactly one. */
function carriageway(doc: OsmDoc, node: string, skip: string): OsmWay | null {
  const found = new Map<string, OsmWay>();
  armsAt(doc, node).forEach((a: Arm) => {
    const w = doc.ways[a.wayId];
    if (a.wayId !== skip && isCarriageway(w)) found.set(w.id, w);
  });
  return found.size === 1 ? [...found.values()][0] : null;
}

const angleDeg = (a: V, b: V) => (Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1]))) * 180) / Math.PI;

/** Short links between opposite carriageways that U-turn to the right. */
function wrongUturns(doc: OsmDoc, ways: readonly OsmWay[]): FlowIssue[] {
  const out: FlowIssue[] = [];
  for (const link of ways) {
    if (link.refs.length < 2 || lengthM(doc, link) > UTURN_LINK_MAX_M) continue;
    const [p, q] = [link.refs[0], link.refs[link.refs.length - 1]];
    const a = carriageway(doc, p, link.id);
    const b = carriageway(doc, q, link.id);
    if (!a || !b || a.id === b.id) continue;
    const ha = heading(doc, a, p);
    const hb = heading(doc, b, q);
    if (!ha || !hb || angleDeg(ha, hb) < OPPOSITE_DEG) continue;
    const to = local(doc, doc.nodes[p].lat);
    const pq: V = [to(q)[0] - to(p)[0], to(q)[1] - to(p)[1]];
    const pqLen = Math.hypot(pq[0], pq[1]) || 1;
    const offAxis = angleDeg(ha, [pq[0] / pqLen, pq[1] / pqLen]);
    // A piece of road running along the carriageways is not a U-turn between them.
    if (offAxis < ACROSS_MIN_DEG || offAxis > 180 - ACROSS_MIN_DEG) continue;
    const dir = direction(link.tags);
    // Each way the link can be driven: along it (p to q) and against it (q to p).
    const moves: Array<{ from: V; across: V; along: boolean }> = [];
    if (dir !== 'backward') moves.push({ from: ha, across: [to(q)[0] - to(p)[0], to(q)[1] - to(p)[1]], along: true });
    if (dir !== 'forward') moves.push({ from: hb, across: [to(p)[0] - to(q)[0], to(p)[1] - to(q)[1]], along: false });
    // The other carriageway lies to the right of travel: the U-turn would be to the right.
    const wrong = moves.filter((m) => m.from[0] * m.across[1] - m.from[1] * m.across[0] < 0);
    if (!wrong.length) continue;
    const fix: FlowFix = dir === 'both'
      ? { type: 'oneway', wayId: link.id, value: wrong[0].along ? '-1' : 'yes' }
      : { type: 'flip', wayId: link.id };
    const mid = link.refs[Math.floor(link.refs.length / 2)];
    out.push({
      id: `wrong-uturn:${link.id}`, kind: 'wrong-uturn', at: lonLat(doc, mid), wayIds: [link.id, a.id, b.id], nodeIds: [p, q], fix,
      message: `Разворот направо через ${name(link)}: машины уходят на встречную проезжую часть ${name(b)}. По ПДД разворот выполняется налево — поменяйте направление съезда`,
    });
  }
  return out;
}

export function flowRuleIssues(doc: OsmDoc): FlowIssue[] {
  const ways = Object.values(doc.ways).filter((w) => isDrivable(w.tags) && w.refs.length > 1 && w.refs.every((r) => doc.nodes[r]));
  return [...headOn(doc, ways), ...wrongUturns(doc, ways)];
}
