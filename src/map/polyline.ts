/** Polylines in local metres: x east, y north. Shared by the lane lines, the road features and their tapers. */

export type V = [number, number];

const M_PER_DEG = (Math.PI / 180) * 6_371_000;

/** Local frame around a latitude: metres east and north. */
export function frame(lat0: number) {
  const k = Math.cos((lat0 * Math.PI) / 180);
  return {
    to: (lon: number, lat: number): V => [lon * M_PER_DEG * k, lat * M_PER_DEG],
    back: ([x, y]: V): V => [x / (M_PER_DEG * k), y / M_PER_DEG],
  };
}

/** Distance from the start to every point. */
export function cumulative(pts: readonly V[]): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i += 1) out.push(out[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return out;
}

export const lengthOf = (pts: readonly V[]) => cumulative(pts)[pts.length - 1] ?? 0;

/** Point at distance `d` along a polyline, and the unit direction there. */
export function along(pts: readonly V[], d: number): { p: V; t: V } {
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

/** The part of a polyline between distances `from` and `to`. */
export function slice(pts: readonly V[], from: number, to: number): V[] {
  const out: V[] = [along(pts, from).p];
  let d = 0;
  for (let i = 0; i + 1 < pts.length; i += 1) {
    d += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    if (d > from && d < to) out.push(pts[i + 1]);
  }
  out.push(along(pts, to).p);
  return out;
}

/** Adds points so that no piece is longer than `step`. */
export function densify(pts: readonly V[], step: number): V[] {
  const out: V[] = [pts[0]];
  for (let i = 1; i < pts.length; i += 1) {
    const [a, b] = [pts[i - 1], pts[i]];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 1; k <= n; k += 1) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

/** A polyline moved sideways, positive to the left: by `off` metres, or by `off[i]` at point i. */
export function offsetLine(pts: readonly V[], off: number | readonly number[]): V[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const o = typeof off === 'number' ? off : off[i];
    return [p[0] - ((b[1] - a[1]) / len) * o, p[1] + ((b[0] - a[0]) / len) * o];
  });
}
