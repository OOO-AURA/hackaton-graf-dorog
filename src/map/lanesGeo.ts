import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import { armKey, armsAt, junctionLanes, junctions, type Arm } from '../osm/lanes';
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

/**
 * Lane ends and lane-to-lane links at junctions. Links are drawn at every junction given;
 * the ends only at `withEnds`, the junction being edited.
 */
export function junctionGeometry(doc: OsmDoc, nodeIds: readonly string[], withEnds: string | null, style: LaneStyle) {
  const ends: Feature<Point, Props>[] = [];
  const links: Feature<LineString, Props>[] = [];
  for (const nodeId of nodeIds) {
    const node = doc.nodes[nodeId];
    if (!node) continue;
    const f = frame(node.lat);
    const r = junctionRadius(doc, nodeId) - (JUNCTION_MARGIN - 0.5);
    const lanes = junctionLanes(doc, nodeId);
    const endOf = (arm: Arm, coming: boolean, i: number) => laneEnd(doc, arm, coming, i, r, f);
    lanes.links.forEach((l) => {
      const a = endOf(l.from, true, l.fromLane);
      const b = endOf(l.to, false, l.toLane);
      links.push({
        type: 'Feature',
        properties: { node: nodeId, from: armKey(l.from), lane: l.fromLane, to: armKey(l.to), turn: l.turn, color: style.color(style.load(l.from.wayId)), edit: nodeId === withEnds },
        geometry: { type: 'LineString', coordinates: curve(a, b).map(f.back) },
      });
    });
    if (nodeId !== withEnds) continue;
    for (const arm of lanes.arms) {
      for (let i = 0; i < arm.lanesIn; i += 1) {
        ends.push({ type: 'Feature', properties: { node: nodeId, arm: armKey(arm), lane: i, kind: 'in' }, geometry: { type: 'Point', coordinates: f.back(endOf(arm, true, i).p) } });
      }
      for (let i = 0; i < arm.lanesOut; i += 1) {
        ends.push({ type: 'Feature', properties: { node: nodeId, arm: armKey(arm), lane: i, kind: 'out' }, geometry: { type: 'Point', coordinates: f.back(endOf(arm, false, i).p) } });
      }
    }
  }
  return {
    ends: { type: 'FeatureCollection', features: ends } as FeatureCollection<Point, Props>,
    links: { type: 'FeatureCollection', features: links } as FeatureCollection<LineString, Props>,
  };
}
