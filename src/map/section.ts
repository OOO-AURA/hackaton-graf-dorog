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
 * Lanes of `wide` beyond the number `narrow` has in their direction merge into the last one.
 */
export function blend(wide: Section, narrow: Section, k: number): CrossSection {
  const lerp = (a: number, b: number) => a + (b - a) * k;
  const lanes: Array<{ travel: Travel; index: number; offset: number }> = [];
  const dividers: LaneDivider[] = [];
  for (const travel of ['forward', 'backward'] as const) {
    const n = wide[travel];
    const m = narrow[travel] || n;
    const offs = Array.from({ length: n }, (_, i) => lerp(laneOffsetIn(wide, travel, i), laneOffsetIn(narrow[travel] ? narrow : wide, travel, Math.min(i, m - 1))));
    offs.forEach((offset, index) => lanes.push({ travel, index, offset }));
    // A marking stays while the lanes on both its sides go on; on the merging lanes it ends where the taper starts.
    for (let i = 0; i + 1 < n; i += 1) {
      if (k === 0 || i + 1 < m) dividers.push({ key: `${travel}:${i}`, offset: (offs[i] + offs[i + 1]) / 2, solid: false });
    }
  }
  if (wide.forward && wide.backward) dividers.unshift({ key: 'centre', offset: 0, solid: true });
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

/** Whether `wide` can narrow into `narrow`: no more lanes in either direction, none appearing or vanishing. */
function narrowsTo(wide: Section, narrow: Section): boolean {
  if (narrow.forward > wide.forward || narrow.backward > wide.backward) return false;
  if (Boolean(narrow.forward) !== Boolean(wide.forward) || Boolean(narrow.backward) !== Boolean(wide.backward)) return false;
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

/** Most a road may turn at a joint and still count as going on into the next one, degrees. */
const MAX_BEND = 35;

/** Slip roads and driveways: a road may change its lanes where one of them joins. */
const isMinor = (tags: Tags) => /_link$/.test(tags.highway ?? '') || tags.highway === 'service';

/**
 * Tapers of every way that narrows into the next one: where a road ends and goes on into a
 * narrower one, either alone (two roads end to end) or with slip roads or driveways joining at
 * the same node. Not at other junctions: lanes that end there are lanes up to the stop line.
 */
export function roadTapers(doc: OsmDoc): Map<string, Taper[]> {
  type End = { wayId: string; atStart: boolean };
  const ends = new Map<string, End[]>();
  const arms = new Map<string, number>();
  const links = new Map<string, number>();
  for (const w of Object.values(doc.ways)) {
    if (!isDrivable(w.tags) || w.refs.length < 2) continue;
    const last = w.refs.length - 1;
    w.refs.forEach((r, i) => {
      const n = (i > 0 ? 1 : 0) + (i < last ? 1 : 0);
      arms.set(r, (arms.get(r) ?? 0) + n);
      if (isMinor(w.tags)) links.set(r, (links.get(r) ?? 0) + n);
    });
    if (w.refs[0] === w.refs[last]) continue;
    for (const [r, atStart] of [[w.refs[0], true], [w.refs[last], false]] as const) {
      const list = ends.get(r);
      if (list) list.push({ wayId: w.id, atStart }); else ends.set(r, [{ wayId: w.id, atStart }]);
    }
  }
  /** Direction from the node along a way end, in local metres. */
  const heading = (e: End): [number, number] | null => {
    const refs = doc.ways[e.wayId].refs;
    const [a, b] = e.atStart ? [refs[0], refs[1]] : [refs[refs.length - 1], refs[refs.length - 2]];
    const [na, nb] = [doc.nodes[a], doc.nodes[b]];
    if (!na || !nb) return null;
    const k = Math.cos((na.lat * Math.PI) / 180);
    const v: [number, number] = [(nb.lon - na.lon) * k, nb.lat - na.lat];
    const l = Math.hypot(v[0], v[1]);
    return l ? [v[0] / l, v[1] / l] : null;
  };
  const out = new Map<string, Taper[]>();
  for (const [node, list] of ends) {
    // The two roads that go on into each other; any other arm must be a slip road ending here.
    const others = (arms.get(node) ?? 0) - 2;
    const main = others === 0 ? list : list.filter((e) => !isMinor(doc.ways[e.wayId].tags));
    if (main.length !== 2 || main[0].wayId === main[1].wayId) continue;
    if (others > 0 && (links.get(node) ?? 0) !== others) continue;
    if (others > 0 && list.length !== arms.get(node)) continue;
    const [ha, hb] = [heading(main[0]), heading(main[1])];
    if (!ha || !hb || -(ha[0] * hb[0] + ha[1] * hb[1]) < Math.cos((MAX_BEND * Math.PI) / 180)) continue;
    const [a, b] = main.map((e) => ({ ...e, s: sectionOf(doc.ways[e.wayId].tags) }));
    for (const [wide, other] of [[a, b], [b, a]] as const) {
      // The other road runs on in this one's direction when one starts where the other ends.
      const narrow = wide.atStart !== other.atStart ? other.s : reverse(other.s);
      if (!narrowsTo(wide.s, narrow)) continue;
      const [ew, en] = [edgesOf(wide.s), edgesOf(narrow)];
      const shift = Math.max(ew.left - en.left, ew.right - en.right);
      const length = Math.min(Math.max(MIN_TAPER, TAPER_RATIO * shift), MAX_SHARE * wayLength(doc, doc.ways[wide.wayId].refs));
      if (length < 2) continue;
      const tapers = out.get(wide.wayId) ?? [];
      tapers.push({ atStart: wide.atStart, length, to: narrow, shift });
      out.set(wide.wayId, tapers);
    }
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
