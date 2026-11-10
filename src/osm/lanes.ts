import { splitWay, setWayTags } from './edit';
import { lanesByDirection } from './profile';
import { isDrivable, withTag } from './tags';
import type { OsmDoc, OsmWay, Tags } from './types';

/**
 * Lanes at junctions and where each one may go. The rules live in the standard `turn:lanes`
 * tags of the approach (`turn:lanes:forward` / `:backward` on two-way roads), lanes listed from
 * left to right in the direction of travel. SUMO builds its lane connections from them with
 * `--osm.turn-lanes`. A lane without a rule gets the usual one: turns left from the leftmost lane,
 * right from the rightmost, straight on from any.
 */

export type Turn = 'sharp_left' | 'left' | 'slight_left' | 'through' | 'slight_right' | 'right' | 'sharp_right' | 'reverse';

export const TURNS: readonly Turn[] = ['sharp_left', 'left', 'slight_left', 'through', 'slight_right', 'right', 'sharp_right', 'reverse'];

const isTurn = (t: string): t is Turn => (TURNS as readonly string[]).includes(t);

/** Turn class of a change of heading in degrees, negative to the left. */
export function classifyTurn(delta: number): Turn {
  const a = Math.abs(delta);
  if (a <= 25) return 'through';
  if (a >= 165) return 'reverse';
  const side = delta < 0 ? 'left' : 'right';
  if (a <= 60) return `slight_${side}`;
  if (a >= 140) return `sharp_${side}`;
  return side;
}

/** -1 for turns to the left, 1 to the right, 0 straight on (reverse counts as the far left). */
export const turnSide = (t: Turn) => (t === 'through' ? 0 : t.includes('left') || t === 'reverse' ? -1 : 1);

/** One road leaving a junction: a way, and which way along it (1 towards later nodes). */
export interface Arm {
  readonly wayId: string;
  readonly index: number;
  readonly step: 1 | -1;
  /** Compass bearing of the road leaving the junction, degrees. */
  readonly bearing: number;
  /** Lanes that come into the junction along this arm, and that leave along it. */
  readonly lanesIn: number;
  readonly lanesOut: number;
}

export const armKey = (a: Pick<Arm, 'wayId' | 'step'>) => `${a.wayId}:${a.step}`;

function bearingDeg(doc: OsmDoc, from: string, to: string): number {
  const a = doc.nodes[from];
  const b = doc.nodes[to];
  const k = Math.cos((a.lat * Math.PI) / 180);
  return ((Math.atan2((b.lon - a.lon) * k, b.lat - a.lat) * 180) / Math.PI + 360) % 360;
}

const drivableWays = (doc: OsmDoc) => Object.values(doc.ways).filter((w) => isDrivable(w.tags) && w.refs.length > 1);

/** Drivable ways through every node, built once per document version. */
const byNodeCache = new WeakMap<OsmDoc, Map<string, OsmWay[]>>();
function waysByNode(doc: OsmDoc): Map<string, OsmWay[]> {
  let index = byNodeCache.get(doc);
  if (index) return index;
  index = new Map();
  for (const w of drivableWays(doc)) {
    for (const r of new Set(w.refs)) {
      const list = index.get(r);
      if (list) list.push(w); else index.set(r, [w]);
    }
  }
  byNodeCache.set(doc, index);
  return index;
}

/** Lanes travelling along a way in its direction (forward) and against it. */
function travelLanes(tags: Tags): { forward: number; backward: number } {
  const { forward, backward } = lanesByDirection(tags);
  if (tags.oneway === '-1') return { forward: 0, backward: forward };
  return { forward, backward };
}

/** Roads around a node; a junction is a node with three or more. */
export function armsAt(doc: OsmDoc, nodeId: string): Arm[] {
  const arms: Arm[] = [];
  for (const w of waysByNode(doc).get(nodeId) ?? []) {
    w.refs.forEach((r, i) => {
      if (r !== nodeId) return;
      const lanes = travelLanes(w.tags);
      for (const step of [1, -1] as const) {
        const next = w.refs[i + step];
        if (next === undefined || !doc.nodes[next]) continue;
        // Leaving along +1 is forward travel; coming in along it is backward travel.
        arms.push({
          wayId: w.id, index: i, step, bearing: bearingDeg(doc, nodeId, next),
          lanesIn: step === 1 ? lanes.backward : lanes.forward,
          lanesOut: step === 1 ? lanes.forward : lanes.backward,
        });
      }
    });
  }
  return arms;
}

/** Nodes where three or more roads meet. */
export function junctions(doc: OsmDoc): string[] {
  const count = new Map<string, number>();
  for (const w of drivableWays(doc)) {
    w.refs.forEach((r, i) => count.set(r, (count.get(r) ?? 0) + (i === 0 || i === w.refs.length - 1 ? 1 : 2)));
  }
  return [...count].filter(([, n]) => n >= 3).map(([id]) => id);
}

/** Heading change from coming in along `from` to leaving along `to`, degrees, negative to the left. */
export function turnDelta(from: Arm, to: Arm): number {
  const inHeading = (from.bearing + 180) % 360;
  return ((to.bearing - inHeading + 540) % 360) - 180;
}

/** Tag holding the lane rules of traffic coming into the junction along an arm. */
function turnKey(tags: Tags, step: 1 | -1): string {
  const oneway = tags.oneway === 'yes' || tags.oneway === '1' || tags.oneway === '-1' || tags.junction === 'roundabout';
  if (oneway) return 'turn:lanes';
  return step === -1 ? 'turn:lanes:forward' : 'turn:lanes:backward';
}

/** Whether the rules of an arm are written at this junction: the way must end here. */
const endsHere = (way: OsmWay, arm: Arm) => (arm.step === -1 ? arm.index === way.refs.length - 1 : arm.index === 0);

export interface Approach {
  readonly arm: Arm;
  /** Allowed turns of every lane, left to right. */
  readonly turns: Turn[][];
  /** Whether the rules come from the file rather than the usual defaults. */
  readonly explicit: boolean;
}

export interface Link {
  readonly from: Arm;
  readonly fromLane: number;
  readonly to: Arm;
  readonly toLane: number;
  readonly turn: Turn;
}

export interface JunctionLanes {
  readonly nodeId: string;
  readonly arms: Arm[];
  readonly approaches: Approach[];
  readonly links: Link[];
}

function parseTurns(value: string, lanes: number): Turn[][] | null {
  const parts = value.split('|');
  if (parts.length !== lanes) return null;
  return parts.map((p) => p.split(';').map((t) => t.trim()).filter(isTurn));
}

/** The usual rules: left turns from the leftmost lane, right from the rightmost, straight from all. */
function defaultTurns(lanes: number, available: readonly Turn[]): Turn[][] {
  const left = available.filter((t) => turnSide(t) < 0 && t !== 'reverse');
  const right = available.filter((t) => turnSide(t) > 0);
  const through = available.includes('through');
  return Array.from({ length: lanes }, (_, i) => {
    const out: Turn[] = [];
    const leftmost = i === 0;
    const rightmost = i === lanes - 1;
    // Without a road straight on, the lanes split between the two sides.
    if (leftmost || (!through && i < lanes / 2)) out.push(...left);
    if (through) out.push('through');
    if (rightmost || (!through && i >= lanes / 2)) out.push(...right);
    return TURNS.filter((t) => out.includes(t));
  });
}

/** Everything about the lanes at one junction: rules per approach and the lane-to-lane links. */
export function junctionLanes(doc: OsmDoc, nodeId: string): JunctionLanes {
  const arms = armsAt(doc, nodeId);
  const approaches: Approach[] = [];
  const links: Link[] = [];
  for (const from of arms) {
    if (!from.lanesIn) continue;
    const exits = arms.filter((a) => a !== from && a.lanesOut > 0).map((to) => ({ to, turn: classifyTurn(turnDelta(from, to)) }));
    const available = TURNS.filter((t) => exits.some((e) => e.turn === t));
    const way = doc.ways[from.wayId];
    const tagged = endsHere(way, from) ? way.tags[turnKey(way.tags, from.step)] : undefined;
    const parsed = tagged ? parseTurns(tagged, from.lanesIn) : null;
    const turns = parsed ?? defaultTurns(from.lanesIn, available);
    approaches.push({ arm: from, turns, explicit: Boolean(parsed) });

    // Lanes that take a turn go to the exit lanes on the same side, in order; straight on they
    // keep to the middle of the exit.
    for (const { to, turn } of exits) {
      const lanes = turns.map((ts, i) => (ts.includes(turn) ? i : -1)).filter((i) => i >= 0);
      const side = turnSide(turn);
      const shift = side < 0 ? 0 : side > 0 ? to.lanesOut - lanes.length : Math.floor((to.lanesOut - lanes.length) / 2);
      lanes.forEach((fromLane, k) => {
        links.push({ from, fromLane, to, toLane: Math.min(to.lanesOut - 1, Math.max(0, k + shift)), turn });
      });
    }
  }
  return { nodeId, arms, approaches, links };
}

const formatTurns = (turns: readonly Turn[][]) => turns.map((ts) => (ts.length ? TURNS.filter((t) => ts.includes(t)).join(';') : 'none')).join('|');

/**
 * Makes the way of an arm end at the junction, splitting it there if it passes through, so that
 * its `turn:lanes` apply at this junction. Rules of the other end stay on the part they belong to.
 * Returns the document and the arm's way id after the split.
 */
export function wayEndingAt(doc: OsmDoc, nodeId: string, arm: Pick<Arm, 'wayId' | 'step'>): { doc: OsmDoc; wayId: string } {
  const way = doc.ways[arm.wayId];
  const at = way?.refs.indexOf(nodeId) ?? -1;
  if (!way || at <= 0 || at >= way.refs.length - 1) return { doc, wayId: arm.wayId };
  const { doc: split, newWayId } = splitWay(doc, way.id, nodeId);
  if (!newWayId) return { doc, wayId: arm.wayId };
  const oneway = turnKey(way.tags, -1) === 'turn:lanes';
  // The first part now ends here going forward, the second starts here: forward rules belong to
  // the second part's far end, backward ones to the first part's far end.
  const strip = (tags: Tags, keys: string[]) => keys.reduce((t, k) => withTag(t, k, null), tags);
  let d = split;
  d = setWayTags(d, way.id, strip(d.ways[way.id].tags, oneway ? ['turn:lanes'] : ['turn:lanes:forward']));
  d = setWayTags(d, newWayId, strip(d.ways[newWayId].tags, oneway ? [] : ['turn:lanes:backward']));
  return { doc: d, wayId: arm.step === -1 ? way.id : newWayId };
}

/** Writes the turns of every lane of an approach. */
export function setApproachTurns(doc: OsmDoc, nodeId: string, arm: Pick<Arm, 'wayId' | 'step'>, turns: readonly Turn[][]): OsmDoc {
  const { doc: d, wayId } = wayEndingAt(doc, nodeId, arm);
  const way = d.ways[wayId];
  return setWayTags(d, wayId, withTag(way.tags, turnKey(way.tags, arm.step), formatTurns(turns)));
}

const MAX_APPROACH_LANES = 8;

/**
 * Sets how many lanes come into the junction along an arm. Only the piece of road before the
 * junction changes (a road passing through is split there), only in that direction, and the turn
 * rules of the approach go back to the usual ones, since they were written for the old count.
 */
export function setApproachLanes(doc: OsmDoc, nodeId: string, arm: Pick<Arm, 'wayId' | 'step'>, lanes: number): OsmDoc {
  const n = Math.max(1, Math.min(MAX_APPROACH_LANES, Math.round(lanes)));
  const { doc: d, wayId } = wayEndingAt(doc, nodeId, arm);
  const way = d.ways[wayId];
  if (!way) return doc;
  const key = turnKey(way.tags, arm.step);
  let tags = withTag(way.tags, key, null);
  if (key === 'turn:lanes') {
    tags = withTag(tags, 'lanes', String(n));
  } else {
    // Coming in along an arm laid out with the way (+1) is travel against it.
    const { forward, backward } = travelLanes(way.tags);
    const [f, b] = arm.step === 1 ? [forward, n] : [n, backward];
    tags = withTag(withTag(withTag(tags, 'lanes:forward', String(f)), 'lanes:backward', String(b)), 'lanes', String(f + b));
  }
  return setWayTags(d, wayId, tags);
}

const sameArm = (a: Pick<Arm, 'wayId' | 'step'>, b: Pick<Arm, 'wayId' | 'step'>) => a.wayId === b.wayId && a.step === b.step;

/** Allows or forbids one turn from one lane of an approach; the other lanes keep what they had. */
export function toggleLaneTurn(doc: OsmDoc, nodeId: string, arm: Pick<Arm, 'wayId' | 'step'>, lane: number, turn: Turn): OsmDoc {
  const approach = junctionLanes(doc, nodeId).approaches.find((a) => sameArm(a.arm, arm));
  if (!approach || lane < 0 || lane >= approach.turns.length) return doc;
  const turns = approach.turns.map((ts, i) => (i !== lane ? ts : ts.includes(turn) ? ts.filter((t) => t !== turn) : [...ts, turn]));
  return setApproachTurns(doc, nodeId, arm, turns);
}

export type JunctionTemplate = 'usual' | 'strict' | 'free';

/** Splits every road that passes through the node there, so each one ends at the junction. */
function splitThrough(doc: OsmDoc, nodeId: string): OsmDoc {
  let d = doc;
  for (const w of drivableWays(doc)) {
    const at = w.refs.indexOf(nodeId);
    if (at > 0 && at < w.refs.length - 1) d = wayEndingAt(d, nodeId, { wayId: w.id, step: -1 }).doc;
  }
  return d;
}

/**
 * Rules for the whole junction at once.
 * `usual` drops written rules (each lane follows the defaults), `strict` writes them: right turns
 * only from the rightmost lane and left only from the leftmost, `free` lets every lane go anywhere.
 */
export function applyJunctionTemplate(doc: OsmDoc, nodeId: string, template: JunctionTemplate): OsmDoc {
  if (template === 'usual') {
    let d = doc;
    for (const arm of armsAt(doc, nodeId)) {
      const way = d.ways[arm.wayId];
      if (way && endsHere(way, arm)) d = setWayTags(d, way.id, withTag(way.tags, turnKey(way.tags, arm.step), null));
    }
    return d;
  }
  let d = splitThrough(doc, nodeId);
  for (const approach of junctionLanes(d, nodeId).approaches) {
    const arm = approach.arm;
    const present = TURNS.filter((t) => t !== 'reverse' && junctionLanes(d, nodeId).arms
      .some((to) => !sameArm(to, arm) && to.lanesOut > 0 && classifyTurn(turnDelta(arm, to)) === t));
    const turns = template === 'free' ? approach.turns.map(() => present) : defaultTurns(approach.turns.length, present);
    d = setApproachTurns(d, nodeId, arm, turns);
  }
  return d;
}
