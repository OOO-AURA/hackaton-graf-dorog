import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson';
import { armKey, armsAt, junctionLanes, junctions, turnSide, type Arm, type Turn } from '../osm/lanes';
import { lanesByDirection } from '../osm/profile';
import { isDrivable } from '../osm/tags';
import type { OsmDoc, OsmWay, Tags } from '../osm/types';

/**
 * Geometry of lanes for the map: every lane as a thin line along its road, cut back at
 * junctions; the end of every lane at a junction as a point; and the lane-to-lane links across
 * the junction as curves. Worked out in local metres around each node and turned back into
 * longitude and latitude.
 */

type Props = Record<string, string | number | boolean>;
type V = [number, number];

const LANE_WIDTH = 3.5;
/** How far lanes stop short of the junction centre, beyond the widest road there. */
const JUNCTION_MARGIN = 2;
const CURVE_POINTS = 14;

const M_PER_DEG = (Math.PI / 180) * 6_371_000;

/** Screen pixels per metre at zoom 17 on MapLibre's 512 px tiles; widths in metres become `w17`. */
export const pxPerMetreZ17 = (lat: number) => 2 ** 17 / (78271.517 * Math.cos((lat * Math.PI) / 180));

/** Local frame around a point: metres east and north. */
function frame(lat0: number) {
  const k = Math.cos((lat0 * Math.PI) / 180);
  return {
    to: (lon: number, lat: number): V => [lon * M_PER_DEG * k, lat * M_PER_DEG],
    back: ([x, y]: V): V => [x / (M_PER_DEG * k), y / M_PER_DEG],
  };
}

function travelLanes(tags: Tags): { forward: number; backward: number } {
  const { forward, backward } = lanesByDirection(tags);
  return tags.oneway === '-1' ? { forward: 0, backward: forward } : { forward, backward };
}

/** Lane width of a road: its `width` shared out, else 3.5 m. */
function laneWidth(tags: Tags): number {
  const { forward, backward } = travelLanes(tags);
  const w = Number.parseFloat(tags.width ?? '');
  return Number.isFinite(w) && w > 0 ? Math.max(2.5, Math.min(4.5, w / Math.max(1, forward + backward))) : LANE_WIDTH;
}

/**
 * Offset of a lane centre from the way's line, metres, positive to the left of the way's
 * direction. Lanes count from the left in their own direction of travel; on a two-way road
 * forward lanes keep to the right of the line and backward ones to the left.
 */
export function laneOffset(tags: Tags, travel: 'forward' | 'backward', index: number): number {
  const { forward, backward } = travelLanes(tags);
  const w = laneWidth(tags);
  if (forward && backward) return travel === 'forward' ? -(index + 0.5) * w : (index + 0.5) * w;
  const n = forward || backward;
  const fromLeft = ((n - 1) / 2 - index) * w;
  return travel === 'forward' ? fromLeft : -fromLeft;
}

/** A marking between two lanes: solid between the two directions, dashed between lanes of one. */
export interface LaneDivider {
  /** Metres from the way's line, positive to the left of the way's direction, like laneOffset. */
  readonly offset: number;
  readonly solid: boolean;
}

/** Lane markings of a road, the centre line first on a two-way road. */
export function dividerOffsets(tags: Tags): LaneDivider[] {
  const { forward, backward } = travelLanes(tags);
  const w = laneWidth(tags);
  const between = (n: number, sign: number) => Array.from({ length: Math.max(0, n - 1) }, (_, k) => ({ offset: sign * (k + 1) * w, solid: false }));
  if (forward && backward) return [{ offset: 0, solid: true }, ...between(forward, -1), ...between(backward, 1)];
  const n = forward || backward;
  return Array.from({ length: Math.max(0, n - 1) }, (_, k) => ({ offset: (n / 2 - (k + 1)) * w, solid: false }));
}

/** Carriageway width in metres: its lanes side by side. */
export function roadWidthMetres(tags: Tags): number {
  const { forward, backward } = travelLanes(tags);
  return (forward + backward) * laneWidth(tags);
}

const halfWidth = (tags: Tags) => roadWidthMetres(tags) / 2;

/** How far from the centre of a junction its lanes end. */
function junctionRadius(doc: OsmDoc, nodeId: string): number {
  return Math.max(...armsAt(doc, nodeId).map((a) => halfWidth(doc.ways[a.wayId].tags)), 3) + JUNCTION_MARGIN;
}

/** Point at distance `d` along a polyline, and the unit direction there. */
function along(pts: readonly V[], d: number): { p: V; t: V } {
  let rest = d;
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const [a, b] = [pts[i], pts[i + 1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const t: V = len ? [(b[0] - a[0]) / len, (b[1] - a[1]) / len] : [1, 0];
    if (rest <= len || i + 2 === pts.length) {
      const k = Math.min(rest, len);
      return { p: [a[0] + t[0] * k, a[1] + t[1] * k], t };
    }
    rest -= len;
  }
  return { p: pts[0], t: [1, 0] };
}

const lengthOf = (pts: readonly V[]) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);

/** The part of a polyline between distances `from` and `to`. */
function slice(pts: readonly V[], from: number, to: number): V[] {
  const out: V[] = [along(pts, from).p];
  let d = 0;
  for (let i = 0; i + 1 < pts.length; i += 1) {
    d += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    if (d > from && d < to) out.push(pts[i + 1]);
  }
  out.push(along(pts, to).p);
  return out;
}

/** A polyline moved sideways by `off` metres, positive to the left. */
function offsetLine(pts: readonly V[], off: number): V[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [p[0] - ((b[1] - a[1]) / len) * off, p[1] + ((b[0] - a[0]) / len) * off];
  });
}

export interface LaneStyle {
  /** Load of a way, volume over capacity, when the flows have been computed. */
  load: (wayId: string) => number | null;
  color: (vc: number | null) => string;
}

/**
 * Lines of every road, stopping short of junctions: `kind: 'lane'` along the middle of each lane
 * (coloured by its load once the flows are computed), `kind: 'divider'` the markings between lanes.
 */
export function laneLines(doc: OsmDoc, style: LaneStyle): FeatureCollection<LineString, Props> {
  const radius = new Map(junctions(doc).map((id) => [id, junctionRadius(doc, id)]));
  const features: Feature<LineString, Props>[] = [];
  const pieces = (w: OsmWay) => {
    // Pieces of the way between junctions, each cut back by the junction radius at its ends.
    const out: Array<{ refs: string[]; cutStart: number; cutEnd: number }> = [];
    let start = 0;
    w.refs.forEach((r, i) => {
      if (i === 0 || (!radius.has(r) && i < w.refs.length - 1)) return;
      out.push({ refs: w.refs.slice(start, i + 1), cutStart: radius.get(w.refs[start]) ?? 0, cutEnd: radius.get(r) ?? 0 });
      start = i;
    });
    return out;
  };
  for (const w of Object.values(doc.ways)) {
    if (!isDrivable(w.tags) || w.refs.length < 2) continue;
    const { forward, backward } = travelLanes(w.tags);
    const vc = style.load(w.id);
    const raised = Boolean((w.tags.bridge && w.tags.bridge !== 'no') || (w.tags.tunnel && w.tags.tunnel !== 'no'));
    const marks = dividerOffsets(w.tags);
    for (const piece of pieces(w)) {
      const nodes = piece.refs.map((r) => doc.nodes[r]).filter(Boolean);
      if (nodes.length < 2) continue;
      const f = frame(nodes[0].lat);
      const pts = nodes.map((n) => f.to(n.lon, n.lat));
      const len = lengthOf(pts);
      if (len <= piece.cutStart + piece.cutEnd + 0.5) continue;
      const line = slice(pts, piece.cutStart, len - piece.cutEnd);
      const lineAt = (off: number) => ({ type: 'LineString' as const, coordinates: offsetLine(line, off).map(f.back) });
      for (const [travel, n] of [['forward', forward], ['backward', backward]] as const) {
        for (let i = 0; i < n; i += 1) {
          features.push({ type: 'Feature', properties: { way: w.id, kind: 'lane', color: style.color(vc), loaded: vc !== null, raised }, geometry: lineAt(laneOffset(w.tags, travel, i)) });
        }
      }
      for (const m of marks) {
        features.push({ type: 'Feature', properties: { way: w.id, kind: 'divider', solid: m.solid, raised }, geometry: lineAt(m.offset) });
      }
    }
  }
  return { type: 'FeatureCollection', features };
}

/** Where the lane `index` of an arm meets the edge of the junction, and the arm's outward direction. */
function laneEnd(doc: OsmDoc, arm: Arm, coming: boolean, index: number, r: number, f: ReturnType<typeof frame>): { p: V; out: V } {
  const way = doc.ways[arm.wayId];
  const refs = arm.step === 1 ? way.refs.slice(arm.index) : way.refs.slice(0, arm.index + 1).reverse();
  const pts = refs.map((id) => doc.nodes[id]).filter(Boolean).map((n) => f.to(n.lon, n.lat));
  const { p, t } = along(pts, Math.min(r, lengthOf(pts) * 0.45));
  // Coming in along an arm laid out with the way (+1) is travel against the way, and so on;
  // offsets are to the left of the way, which is the arm's own left only when step is +1.
  const travel = (arm.step === 1) === coming ? 'backward' : 'forward';
  const off = laneOffset(way.tags, travel, index) * arm.step;
  return { p: [p[0] - t[1] * off, p[1] + t[0] * off], out: t };
}

/** Cubic curve from a lane coming in to a lane going out, tangent to both. */
function curve(a: { p: V; out: V }, b: { p: V; out: V }): V[] {
  const k = Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1]) / 2.5;
  const c1: V = [a.p[0] - a.out[0] * k, a.p[1] - a.out[1] * k];
  const c2: V = [b.p[0] - b.out[0] * k, b.p[1] - b.out[1] * k];
  return Array.from({ length: CURVE_POINTS + 1 }, (_, i) => {
    const t = i / CURVE_POINTS;
    const u = 1 - t;
    return [
      u * u * u * a.p[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b.p[0],
      u * u * u * a.p[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b.p[1],
    ];
  });
}

/** How a movement is drawn: straight on, to the left, to the right or back. */
export type TurnGroup = 'through' | 'left' | 'right' | 'uturn';
const GROUP_ORDER: readonly TurnGroup[] = ['left', 'through', 'right', 'uturn'];
export const turnGroup = (t: Turn): TurnGroup => (t === 'reverse' ? 'uturn' : t === 'through' ? 'through' : turnSide(t) < 0 ? 'left' : 'right');

/** Image id of the road arrow for the turns of one lane, like `turn-arrow:left-through`. */
export const arrowIcon = (turns: readonly Turn[]) =>
  `turn-arrow:${GROUP_ORDER.filter((g) => turns.some((t) => turnGroup(t) === g)).join('-') || 'none'}`;

/** How far back from the stop line the lane arrows are painted. */
const ARROW_BACK = 9;
/** The stop line stands a little before the lanes end. */
const STOP_BACK = 1;
/** Room around the lane ends inside the junction outline. */
const AREA_MARGIN = 2.5;

const bearingOf = (v: V) => ((Math.atan2(v[0], v[1]) * 180) / Math.PI + 360) % 360;

/** Convex hull of points (monotone chain), counter-clockwise. */
function hull(points: readonly V[]): V[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: V, a: V, b: V) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: V[]) => list.reduce<V[]>((out, p) => {
    while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
    return [...out, p];
  }, []);
  const lower = half(pts);
  const upper = half([...pts].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** The hull pushed out from its centre by `margin` metres, as a closed ring. */
function grow(ring: readonly V[], margin: number): V[] {
  const c: V = [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
  const out = ring.map((p): V => {
    const d = Math.hypot(p[0] - c[0], p[1] - c[1]) || 1;
    return [p[0] + ((p[0] - c[0]) / d) * margin, p[1] + ((p[1] - c[1]) / d) * margin];
  });
  return [...out, out[0]];
}

type Fc<G extends LineString | Point | Polygon> = FeatureCollection<G, Props>;

/**
 * Everything drawn at junctions: the lane-to-lane links as ribbons coloured by turn group, the
 * junction outline, a stop line on every approach and the turn arrows painted on the lanes coming
 * in. The lane ends, where links are dragged from and to, only at `withEnds`, the junction being
 * edited.
 */
export function junctionGeometry(doc: OsmDoc, nodeIds: readonly string[], withEnds: string | null, style: LaneStyle) {
  const ends: Feature<Point, Props>[] = [];
  const links: Feature<LineString, Props>[] = [];
  const areas: Feature<Polygon, Props>[] = [];
  const stops: Feature<LineString, Props>[] = [];
  const arrows: Feature<Point, Props>[] = [];
  for (const nodeId of nodeIds) {
    const node = doc.nodes[nodeId];
    if (!node) continue;
    const f = frame(node.lat);
    const px = pxPerMetreZ17(node.lat);
    const r = junctionRadius(doc, nodeId) - (JUNCTION_MARGIN - 0.5);
    const lanes = junctionLanes(doc, nodeId);
    const endOf = (arm: Arm, coming: boolean, i: number) => laneEnd(doc, arm, coming, i, r, f);
    const edit = nodeId === withEnds;
    lanes.links.forEach((l) => {
      const a = endOf(l.from, true, l.fromLane);
      const b = endOf(l.to, false, l.toLane);
      links.push({
        type: 'Feature',
        properties: {
          node: nodeId, from: armKey(l.from), lane: l.fromLane, to: armKey(l.to), turn: l.turn, group: turnGroup(l.turn),
          w17: laneWidth(doc.ways[l.from.wayId].tags) * px, color: style.color(style.load(l.from.wayId)), edit,
        },
        geometry: { type: 'LineString', coordinates: curve(a, b).map(f.back) },
      });
    });
    const corners: V[] = [];
    for (const arm of lanes.arms) {
      const tags = doc.ways[arm.wayId].tags;
      const w = laneWidth(tags);
      const inEnds = Array.from({ length: arm.lanesIn }, (_, i) => endOf(arm, true, i));
      const outEnds = Array.from({ length: arm.lanesOut }, (_, i) => endOf(arm, false, i));
      [...inEnds, ...outEnds].forEach((e) => corners.push(e.p));
      if (edit) {
        inEnds.forEach((e, i) => ends.push({ type: 'Feature', properties: { node: nodeId, arm: armKey(arm), lane: i, kind: 'in' }, geometry: { type: 'Point', coordinates: f.back(e.p) } }));
        outEnds.forEach((e, i) => ends.push({ type: 'Feature', properties: { node: nodeId, arm: armKey(arm), lane: i, kind: 'out' }, geometry: { type: 'Point', coordinates: f.back(e.p) } }));
      }
      if (!inEnds.length) continue;
      const out = inEnds[0].out;
      const across: V = [-out[1], out[0]];
      const proj = inEnds.map((e) => e.p[0] * across[0] + e.p[1] * across[1]);
      const lo = inEnds[proj.indexOf(Math.min(...proj))].p;
      const hi = inEnds[proj.indexOf(Math.max(...proj))].p;
      const at = (p: V, side: number, back: number): V => [p[0] + across[0] * side * (w / 2) + out[0] * back, p[1] + across[1] * side * (w / 2) + out[1] * back];
      stops.push({ type: 'Feature', properties: { node: nodeId, w17: 0.5 * px }, geometry: { type: 'LineString', coordinates: [at(lo, -1, STOP_BACK), at(hi, 1, STOP_BACK)].map(f.back) } });
      const approach = lanes.approaches.find((ap) => armKey(ap.arm) === armKey(arm));
      inEnds.forEach((e, i) => {
        const p: V = [e.p[0] + out[0] * ARROW_BACK, e.p[1] + out[1] * ARROW_BACK];
        arrows.push({
          type: 'Feature',
          properties: { node: nodeId, icon: arrowIcon(approach?.turns[i] ?? []), bearing: bearingOf([-out[0], -out[1]]), w17: w * px },
          geometry: { type: 'Point', coordinates: f.back(p) },
        });
      });
    }
    if (corners.length >= 3) {
      areas.push({ type: 'Feature', properties: { node: nodeId, edit }, geometry: { type: 'Polygon', coordinates: [grow(hull(corners), AREA_MARGIN).map(f.back)] } });
    }
  }
  const fc = <G extends LineString | Point | Polygon>(features: Feature<G, Props>[]) => ({ type: 'FeatureCollection', features }) as Fc<G>;
  return { ends: fc(ends), links: fc(links), areas: fc(areas), stops: fc(stops), arrows: fc(arrows) };
}

/** Depth of a zebra along the road, metres, and how far it reaches past the carriageway. */
const ZEBRA_DEPTH = 3;
const ZEBRA_MARGIN = 0.5;

const isCrossing = (tags: Tags) => tags.highway === 'crossing' || Boolean(tags.crossing && tags.crossing !== 'no');

/** Zebra crossings: at every crossing node on a road, a band across the carriageway. */
export function zebras(doc: OsmDoc): Fc<LineString> {
  const features: Feature<LineString, Props>[] = [];
  const done = new Set<string>();
  for (const w of Object.values(doc.ways)) {
    if (!isDrivable(w.tags)) continue;
    w.refs.forEach((id, i) => {
      const n = doc.nodes[id];
      if (!n || done.has(id) || !isCrossing(n.tags)) return;
      const a = doc.nodes[w.refs[Math.max(0, i - 1)]];
      const b = doc.nodes[w.refs[Math.min(w.refs.length - 1, i + 1)]];
      if (!a || !b || a === b) return;
      done.add(id);
      const f = frame(n.lat);
      const [pa, pb, p] = [f.to(a.lon, a.lat), f.to(b.lon, b.lat), f.to(n.lon, n.lat)];
      const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) || 1;
      const across: V = [-(pb[1] - pa[1]) / len, (pb[0] - pa[0]) / len];
      const half = halfWidth(w.tags) + ZEBRA_MARGIN;
      features.push({
        type: 'Feature',
        properties: { node: id, w17: ZEBRA_DEPTH * pxPerMetreZ17(n.lat) },
        geometry: { type: 'LineString', coordinates: [[p[0] - across[0] * half, p[1] - across[1] * half], [p[0] + across[0] * half, p[1] + across[1] * half]].map((q) => f.back(q as V)) },
      });
    });
  }
  return { type: 'FeatureCollection', features };
}
