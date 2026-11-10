/**
 * Geometry of drawing a road: the turn of a new segment snapped to round angles, and curves.
 * Bearings are compass degrees, clockwise from north.
 */

export interface LonLatPoint { readonly lon: number; readonly lat: number }

/** Round angles a new segment snaps to, relative to the one before it. */
export const ANGLE_STEP_DEG = 15;
/** A turn within this of a round angle snaps to it even without Shift. */
export const ANGLE_PULL_DEG = 4;
/** Points along a drawn curve, metres apart. */
export const CURVE_STEP_M = 6;

const M_PER_DEG = (Math.PI / 180) * 6_371_000;

function frame(lat0: number) {
  const k = Math.cos((lat0 * Math.PI) / 180);
  return {
    to: (p: LonLatPoint): [number, number] => [p.lon * M_PER_DEG * k, p.lat * M_PER_DEG],
    back: ([x, y]: [number, number]): LonLatPoint => ({ lon: x / (M_PER_DEG * k), lat: y / M_PER_DEG }),
  };
}

export const bearingDeg = (a: LonLatPoint, b: LonLatPoint) => {
  const f = frame(a.lat);
  const [pa, pb] = [f.to(a), f.to(b)];
  return ((Math.atan2(pb[0] - pa[0], pb[1] - pa[1]) * 180) / Math.PI + 360) % 360;
};

export const distanceM = (a: LonLatPoint, b: LonLatPoint) => {
  const f = frame(a.lat);
  const [pa, pb] = [f.to(a), f.to(b)];
  return Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
};

/** Signed turn from one bearing to another, -180..180, positive to the right. */
export const turnDeg = (from: number, to: number) => ((to - from + 540) % 360) - 180;

/**
 * The pointer moved so the segment from `last` turns onto a round angle from `prevBearing` (or
 * onto a round compass bearing for the first segment): always with `force` (Shift), and by itself
 * when it is within a few degrees. The length stays as drawn. Returns the point and its turn.
 */
export function snapAngle(last: LonLatPoint, target: LonLatPoint, prevBearing: number | null, force: boolean): { point: LonLatPoint; turn: number | null; snapped: boolean } {
  const length = distanceM(last, target);
  if (length < 0.5) return { point: target, turn: null, snapped: false };
  const raw = bearingDeg(last, target);
  const base = prevBearing ?? 0;
  const turn = turnDeg(base, raw);
  const round = Math.round(turn / ANGLE_STEP_DEG) * ANGLE_STEP_DEG;
  const snap = force || Math.abs(turn - round) <= ANGLE_PULL_DEG;
  const finalTurn = snap ? round : turn;
  if (!snap) return { point: target, turn: prevBearing === null ? null : turn, snapped: false };
  const b = ((base + finalTurn) * Math.PI) / 180;
  const f = frame(last.lat);
  const p = f.to(last);
  return { point: f.back([p[0] + Math.sin(b) * length, p[1] + Math.cos(b) * length]), turn: prevBearing === null ? null : finalTurn, snapped: true };
}

/**
 * A smooth curve from `a` to `b` bent towards `control` (a quadratic Bézier), as points every few
 * metres, without its two ends. A control point far ahead with `b` beside `a` makes a U-turn loop.
 */
export function curvePoints(a: LonLatPoint, control: LonLatPoint, b: LonLatPoint, step = CURVE_STEP_M): LonLatPoint[] {
  const f = frame(a.lat);
  const [pa, pc, pb] = [f.to(a), f.to(control), f.to(b)];
  const approx = Math.hypot(pc[0] - pa[0], pc[1] - pa[1]) + Math.hypot(pb[0] - pc[0], pb[1] - pc[1]);
  const n = Math.max(2, Math.ceil(approx / step));
  return Array.from({ length: n - 1 }, (_, i) => {
    const t = (i + 1) / n;
    const u = 1 - t;
    return f.back([u * u * pa[0] + 2 * u * t * pc[0] + t * t * pb[0], u * u * pa[1] + 2 * u * t * pc[1] + t * t * pb[1]]);
  });
}

/** Corners sharper than this get rounded, degrees of turn. */
const ROUND_MIN_TURN_DEG = 10;
/** A rounded corner takes at most this share of each segment next to it. */
const ROUND_MAX_SHARE = 0.45;

interface Corner extends LonLatPoint { readonly nodeId?: string; readonly wayId?: string }

/**
 * A drawn road with its corners rounded, as roads are built: every free point where the road turns
 * by more than a few degrees becomes an arc of `radius` metres (less where the segments are short).
 * Points that join a node or another road stay where they are: the road meets it there.
 */
export function roundCorners<P extends Corner>(points: readonly P[], radius: number): Array<P | LonLatPoint> {
  if (points.length < 3) return [...points];
  const out: Array<P | LonLatPoint> = [points[0]];
  for (let i = 1; i < points.length - 1; i += 1) {
    const [a, v, b] = [points[i - 1], points[i], points[i + 1]];
    const turn = Math.abs(turnDeg(bearingDeg(a, v), bearingDeg(v, b)));
    if (v.nodeId || v.wayId || turn < ROUND_MIN_TURN_DEG || turn > 175) { out.push(v); continue; }
    const half = ((turn / 2) * Math.PI) / 180;
    const reach = Math.min(radius * Math.tan(half), distanceM(a, v) * ROUND_MAX_SHARE, distanceM(v, b) * ROUND_MAX_SHARE);
    const f = frame(v.lat);
    const [pa, pv, pb] = [f.to(a), f.to(v), f.to(b)];
    const towards = (p: [number, number], d: number) => {
      const len = Math.hypot(p[0] - pv[0], p[1] - pv[1]) || 1;
      return f.back([pv[0] + ((p[0] - pv[0]) / len) * d, pv[1] + ((p[1] - pv[1]) / len) * d]);
    };
    const [t1, t2] = [towards(pa, reach), towards(pb, reach)];
    out.push(t1, ...curvePoints(t1, v, t2, CURVE_STEP_M / 2), t2);
  }
  out.push(points[points.length - 1]);
  return out;
}
