import { lanesByDirection } from '../osm/profile';
import { isDrivable } from '../osm/tags';
import type { OsmDoc, Tags } from '../osm/types';
import { cumulative, frame } from './polyline';

/**
 * Cross-section of a road: where its edges, lanes and lane markings lie across the way's line,
 * in metres, positive to the left of the way's direction. On a two-way road forward lanes keep
 * to the right of the line and backward ones to the left, so the line is the centre line and the
 * carriageway is off-centre when the two directions have a different number of lanes; a one-way
 * road is centred on its line.
 *
 * Where a road meets one with fewer lanes and simply goes on into it, the wider one narrows over
 * a taper before the joint instead of stopping with a step: the edges close in, the lanes that
 * end merge into their neighbour and their markings stop where the taper begins.
 */

export const LANE_WIDTH = 3.5;

export type Travel = 'forward' | 'backward';

/** Lanes of a road in the way's direction and against it, and their width. */
export interface Section {
  readonly forward: number;
  readonly backward: number;
  readonly lane: number;
}

export function sectionOf(tags: Tags): Section {
  const byDir = lanesByDirection(tags);
  const { forward, backward } = tags.oneway === '-1' ? { forward: 0, backward: byDir.forward } : byDir;
  const w = Number.parseFloat(tags.width ?? '');
  const lane = Number.isFinite(w) && w > 0 ? Math.max(2.5, Math.min(4.5, w / Math.max(1, forward + backward))) : LANE_WIDTH;
  return { forward, backward, lane };
}

/** The same road seen from its other end. */
export const reverse = (s: Section): Section => ({ forward: s.backward, backward: s.forward, lane: s.lane });

/** Offset of the centre of lane `index` (counted from the left in its own direction of travel). */
export function laneOffsetIn(s: Section, travel: Travel, index: number): number {
  const w = s.lane;
  if (s.forward && s.backward) return travel === 'forward' ? -(index + 0.5) * w : (index + 0.5) * w;
  const n = s.forward || s.backward;
  const fromLeft = ((n - 1) / 2 - index) * w;
  return travel === 'forward' ? fromLeft : -fromLeft;
}

/** Offsets of the left and right edges of the carriageway; `right` is counted to the right. */
export function edgesOf(s: Section): { left: number; right: number } {
  if (s.forward && s.backward) return { left: s.backward * s.lane, right: s.forward * s.lane };
  const half = ((s.forward || s.backward) * s.lane) / 2;
  return { left: half, right: half };
}

export const widthOf = (s: Section) => (s.forward + s.backward) * s.lane;

/** A marking between two lanes: solid between the two directions, dashed between lanes of one. */
export interface LaneDivider {
  /** Which marking this is, the same all along the road: `centre` or `<travel>:<lane on its left>`. */
  readonly key: string;
  readonly offset: number;
  readonly solid: boolean;
}

export interface CrossSection {
  readonly left: number;
  readonly right: number;
  readonly lanes: ReadonlyArray<{ readonly travel: Travel; readonly index: number; readonly offset: number }>;
  readonly dividers: readonly LaneDivider[];
}

/**
 * The cross-section `k` of the way from `wide` to `narrow` (0 is all `wide`, 1 all `narrow`).
 * Lanes of `wide` beyond the number `narrow` has in their direction merge into the last one;
 * lanes of a direction `narrow` does not have (a two-way road going on as a one-way one) end
 * where the taper starts, with their markings and the centre line.
 */
export function blend(wide: Section, narrow: Section, k: number): CrossSection {
  const lerp = (a: number, b: number) => a + (b - a) * k;
  const lanes: Array<{ travel: Travel; index: number; offset: number }> = [];
  const dividers: LaneDivider[] = [];
  for (const travel of ['forward', 'backward'] as const) {
    const n = wide[travel];
    const m = narrow[travel];
    if (k > 0 && !m) continue;
    const to = (i: number) => (m ? laneOffsetIn(narrow, travel, Math.min(i, m - 1)) : laneOffsetIn(wide, travel, i));
    const offs = Array.from({ length: n }, (_, i) => lerp(laneOffsetIn(wide, travel, i), to(i)));
    offs.forEach((offset, index) => lanes.push({ travel, index, offset }));
    // A marking stays while the lanes on both its sides go on; on the merging lanes it ends where the taper starts.
    for (let i = 0; i + 1 < n; i += 1) {
      if (k === 0 || i + 1 < m) dividers.push({ key: `${travel}:${i}`, offset: (offs[i] + offs[i + 1]) / 2, solid: false });
    }
  }
  if (wide.forward && wide.backward && (k === 0 || (narrow.forward && narrow.backward))) dividers.unshift({ key: 'centre', offset: 0, solid: true });
  const [a, b] = [edgesOf(wide), edgesOf(narrow)];
  return { left: lerp(a.left, b.left), right: lerp(a.right, b.right), lanes, dividers };
}

export const plainSection = (s: Section) => blend(s, s, 0);

/** A taper at one end of a way: over `length` metres from there the road narrows to `to`. */
export interface Taper {
  readonly atStart: boolean;
  readonly length: number;
  /** The narrower road it goes on into, seen in this way's direction. */
  readonly to: Section;
  /** How far the edges move in, metres: sets how finely the taper is drawn. */
  readonly shift: number;
}

/** Taper length per metre the edge moves in. */
const TAPER_RATIO = 8;
const MIN_TAPER = 10;
/** A taper takes at most this share of its way, so one at each end never overlap. */
const MAX_SHARE = 0.45;

/** Whether `wide` narrows into `narrow`: it is wider and they share a direction of travel. */
function narrowsTo(wide: Section, narrow: Section): boolean {
  if (!((wide.forward && narrow.forward) || (wide.backward && narrow.backward))) return false;
  return widthOf(narrow) < widthOf(wide) - 0.05;
}

/** Length of a way in metres. */
function wayLength(doc: OsmDoc, refs: readonly string[]): number {
  const nodes = refs.map((r) => doc.nodes[r]).filter(Boolean);
  if (nodes.length < 2) return 0;
  const f = frame(nodes[0].lat);
  const d = cumulative(nodes.map((n) => f.to(n.lon, n.lat)));
  return d[d.length - 1];
}

/** Most a road may turn at a node and still count as going on into the next one, degrees. */
const MAX_BEND = 35;
/** Roads leaving a node closer together than this run side by side from it, degrees. */
export const SIDE_BY_SIDE = 35;

/** Slip roads and driveways: a road goes on into one of them only when there is nothing else. */
export const isMinor = (tags: Tags) => /_link$/.test(tags.highway ?? '') || tags.highway === 'service';

/**
 * Tapers of every way that goes on into a narrower road: at every node, junctions included,
 * where a way ends and another road leaves the node nearly straight ahead. Each way end is
 * paired with the arm that goes on straightest (main roads before slip roads and driveways),
 * and only when that arm takes it back as its own best match.
 */
export function roadTapers(doc: OsmDoc): Map<string, Taper[]> {
  /** A road leaving a node: along way `wayId` from point `index`, `step` +1 with the way, −1 against it. */
  type Arm = { wayId: string; index: number; step: 1 | -1 };
  const atNode = new Map<string, Arm[]>();
  for (const w of Object.values(doc.ways)) {
    if (!isDrivable(w.tags) || w.refs.length < 2) continue;
    const last = w.refs.length - 1;
    w.refs.forEach((r, index) => {
      const list = atNode.get(r) ?? [];
      if (index < last) list.push({ wayId: w.id, index, step: 1 });
      if (index > 0) list.push({ wayId: w.id, index, step: -1 });
      atNode.set(r, list);
    });
  }
  const heading = (a: Arm): [number, number] | null => {
    const refs = doc.ways[a.wayId].refs;
    const [na, nb] = [doc.nodes[refs[a.index]], doc.nodes[refs[a.index + a.step]]];
    if (!na || !nb) return null;
    const k = Math.cos((na.lat * Math.PI) / 180);
    const v: [number, number] = [(nb.lon - na.lon) * k, nb.lat - na.lat];
    const l = Math.hypot(v[0], v[1]);
    return l ? [v[0] / l, v[1] / l] : null;
  };
  const straight = Math.cos((MAX_BEND * Math.PI) / 180);
  const out = new Map<string, Taper[]>();
  for (const arms of atNode.values()) {
    if (arms.length < 2) continue;
    const dirs = arms.map(heading);
    /** The arm that goes on from arm `i` straightest, or -1. */
    const best = (i: number): number => {
      let pick = -1;
      let key = [Infinity, Infinity];
      arms.forEach((b, j) => {
        if (j === i || b.wayId === arms[i].wayId || !dirs[i] || !dirs[j]) return;
        const along = -(dirs[i]![0] * dirs[j]![0] + dirs[i]![1] * dirs[j]![1]);
        if (along < straight) return;
        const k = [isMinor(doc.ways[b.wayId].tags) ? 1 : 0, -along];
        if (k[0] < key[0] || (k[0] === key[0] && k[1] < key[1])) { key = k; pick = j; }
      });
      return pick;
    };
    arms.forEach((arm, i) => {
      const way = doc.ways[arm.wayId];
      // Only a way that ends here can narrow before the node.
      const atStart = arm.index === 0;
      if (!atStart && arm.index !== way.refs.length - 1) return;
      const j = best(i);
      if (j < 0 || best(j) !== i) return;
      const other = arms[j];
      const base = sectionOf(way.tags);
      // Seen in this way's direction: the other road runs on with it when they leave the node opposite ways.
      const narrow = (other.step === 1) !== atStart ? sectionOf(doc.ways[other.wayId].tags) : reverse(sectionOf(doc.ways[other.wayId].tags));
      if (!narrowsTo(base, narrow)) return;
      // A fork, not a narrowing: the roads that go on side by side with the best one take all
      // the lanes between them (a dual carriageway splitting, slip roads leaving at a bridge end).
      const sideBySide = (k: number) => Boolean(dirs[k] && dirs[j]) && dirs[k]![0] * dirs[j]![0] + dirs[k]![1] * dirs[j]![1] >= Math.cos((SIDE_BY_SIDE * Math.PI) / 180);
      const fork = arms.filter((b, k) => k !== i && b.wayId !== arm.wayId && sideBySide(k));
      if (fork.length > 1 && fork.reduce((sum, b) => sum + widthOf(sectionOf(doc.ways[b.wayId].tags)), 0) >= widthOf(base) - 0.05) return;
      const [ew, en] = [edgesOf(base), edgesOf(narrow)];
      const shift = Math.max(ew.left - en.left, ew.right - en.right, 0.1);
      const length = Math.min(Math.max(MIN_TAPER, TAPER_RATIO * shift), MAX_SHARE * wayLength(doc, way.refs));
      if (length < 2) return;
      const list = out.get(way.id) ?? [];
      list.push({ atStart, length, to: narrow, shift });
      out.set(way.id, list);
    });
  }
  return out;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** How far into a taper distance `d` of a way `total` metres long is: 0 outside, 1 at the joint. */
export function taperAt(tapers: readonly Taper[] | undefined, d: number, total: number): { taper: Taper; k: number } | null {
  for (const t of tapers ?? []) {
    const into = t.atStart ? t.length - d : d - (total - t.length);
    if (into > 0) return { taper: t, k: smooth(Math.min(1, into / t.length)) };
  }
  return null;
}

/** Cross-section of a way at distance `d` from its start. */
export function sectionAt(base: Section, tapers: readonly Taper[] | undefined, d: number, total: number): CrossSection {
  const at = taperAt(tapers, d, total);
  return at ? blend(base, at.taper.to, at.k) : plainSection(base);
}

/**
 * Distances along a way where its road feature is cut so each piece can have its own width:
 * the ends, and the tapers in steps fine enough (edges moving in 4 cm at a time) that the
 * pieces' round caps join into a smooth edge.
 */
export function taperBreaks(tapers: readonly Taper[] | undefined, total: number): number[] {
  const out = new Set<number>([0, total]);
  for (const t of tapers ?? []) {
    const n = Math.max(6, Math.min(100, Math.ceil(t.shift / 0.04)));
    const from = t.atStart ? 0 : total - t.length;
    for (let i = 0; i <= n; i += 1) out.add(from + (t.length * i) / n);
  }
  return [...out].sort((x, y) => x - y);
}
