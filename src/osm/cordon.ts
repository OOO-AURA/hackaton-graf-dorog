/**
 * Fragment boundary ("cordon") handling.
 *
 * A city fragment cut out of OSM leaves roads that simply stop at the edge of the box.
 * A one-way carriageway that leaves the box looks like a dead end to the routers, and
 * MATSim's NetworkCleaner drops it together with everything that only leads there. In the
 * task example this removes the whole Pervomaisky-Universitetsky bypass.
 *
 * Transport models solve this with cordon connectors: the two carriageways of a cut divided
 * road are joined just outside the study area, so traffic can enter and leave in both
 * directions. Here a connector is an ordinary one-way way between the two cut ends.
 */
import { createWay } from './edit';
import { haversine, type LonLat } from './geo';
import { directedArcs, drivableWays } from './roads';
import { direction } from './tags';
import type { OsmDoc, OsmWay } from './types';

/** A road end this close to the bounds is treated as cut by the fragment edge. */
export const CORDON_EDGE_M = 60;
/** Cut ends of two carriageways closer than this are taken as one divided road. */
export const CORDON_PAIR_M = 90;
/** Marks connectors so they can be found, listed and explained later. */
export const CORDON_NOTE = 'cordon connector';

export interface CordonEnd {
  readonly nodeId: string;
  readonly wayId: string;
  /** 'out': traffic leaves the fragment here; 'in': enters; 'both': two-way road. */
  readonly flow: 'in' | 'out' | 'both';
}

export interface CordonPair {
  readonly from: CordonEnd;
  readonly to: CordonEnd;
  readonly distanceM: number;
}

function boundsBox(doc: OsmDoc): [number, number, number, number] | null {
  const b = doc.bounds;
  if (!b) return null;
  const box = [b.minlat, b.minlon, b.maxlat, b.maxlon].map(Number);
  return box.every(Number.isFinite) ? (box as [number, number, number, number]) : null;
}

/** Distance in metres from a point inside the box to its nearest edge; 0 when outside. */
function distanceToEdge(box: [number, number, number, number], lon: number, lat: number): number {
  const [minLat, minLon, maxLat, maxLon] = box;
  if (lat <= minLat || lat >= maxLat || lon <= minLon || lon >= maxLon) return 0;
  const p: LonLat = [lon, lat];
  return Math.min(
    haversine(p, [lon, minLat]), haversine(p, [lon, maxLat]),
    haversine(p, [minLon, lat]), haversine(p, [maxLon, lat]),
  );
}

/** Road ends (nodes used by a single drivable way, at its first or last position) near the fragment edge. */
export function cordonEnds(doc: OsmDoc, ways: readonly OsmWay[] = drivableWays(doc)): CordonEnd[] {
  const box = boundsBox(doc);
  if (!box) return [];
  const uses = new Map<string, number>();
  ways.forEach((w) => new Set(w.refs).forEach((r) => uses.set(r, (uses.get(r) ?? 0) + 1)));
  const ends: CordonEnd[] = [];
  ways.forEach((w) => {
    const dir = direction(w.tags);
    [0, w.refs.length - 1].forEach((i) => {
      const id = w.refs[i];
      if (uses.get(id) !== 1 || (i > 0 && w.refs[0] === id)) return;
      const node = doc.nodes[id];
      if (distanceToEdge(box, node.lon, node.lat) > CORDON_EDGE_M) return;
      const atStart = i === 0;
      const flow = dir === 'both' ? 'both' : (dir === 'forward') === atStart ? 'in' : 'out';
      ends.push({ nodeId: id, wayId: w.id, flow });
    });
  });
  return ends;
}

/**
 * Pairs every one-way exit with the nearest one-way entry of another carriageway.
 * Each end is used once; pairs already joined by a connector are skipped.
 */
export function cordonPairs(doc: OsmDoc, ends: readonly CordonEnd[] = cordonEnds(doc)): CordonPair[] {
  const at = (e: CordonEnd): LonLat => [doc.nodes[e.nodeId].lon, doc.nodes[e.nodeId].lat];
  const candidates = ends.filter((e) => e.flow === 'out').flatMap((from) =>
    ends.filter((to) => to.flow === 'in' && to.wayId !== from.wayId)
      .map((to) => ({ from, to, distanceM: haversine(at(from), at(to)) }))
      .filter((p) => p.distanceM <= CORDON_PAIR_M));
  candidates.sort((a, b) => a.distanceM - b.distanceM);
  const used = new Set<string>();
  return candidates.filter((p) => {
    if (used.has(p.from.nodeId) || used.has(p.to.nodeId)) return false;
    used.add(p.from.nodeId);
    used.add(p.to.nodeId);
    return true;
  });
}

const CLASS_RANK = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'service'];
const baseClass = (h = '') => h.replace(/_link$/, '');

/** Joins a cut exit to the matching cut entry with a one-way connector of the same road class. */
export function addCordonConnector(doc: OsmDoc, pair: CordonPair): { doc: OsmDoc; id: string } {
  const a = doc.ways[pair.from.wayId].tags;
  const b = doc.ways[pair.to.wayId].tags;
  const [ca, cb] = [baseClass(a.highway), baseClass(b.highway)];
  const highway = CLASS_RANK.indexOf(ca) >= 0 && CLASS_RANK.indexOf(ca) >= CLASS_RANK.indexOf(cb) ? ca : cb || ca;
  const tags: Record<string, string> = { highway, oneway: 'yes', lanes: '1', note: CORDON_NOTE };
  const speed = a.maxspeed ?? b.maxspeed;
  if (speed) tags.maxspeed = speed;
  return createWay(doc, [pair.from.nodeId, pair.to.nodeId], tags);
}

export function addAllCordonConnectors(doc: OsmDoc): { doc: OsmDoc; added: number } {
  return cordonPairs(doc).reduce((acc, pair) => ({ doc: addCordonConnector(acc.doc, pair).doc, added: acc.added + 1 }), { doc, added: 0 });
}

/** Nodes reachable from `starts` following arcs forward, or against them when `reverse` is set. */
export function reachable(ways: readonly OsmWay[], starts: Iterable<string>, reverse = false): Set<string> {
  const next = new Map<string, string[]>();
  directedArcs(ways).forEach(({ from, to }) => {
    const [a, b] = reverse ? [to, from] : [from, to];
    const list = next.get(a);
    if (list) list.push(b); else next.set(a, [b]);
  });
  const seen = new Set<string>();
  const stack = [...starts];
  while (stack.length) {
    const n = stack.pop()!;
    if (seen.has(n)) continue;
    seen.add(n);
    next.get(n)?.forEach((m) => stack.push(m));
  }
  return seen;
}
