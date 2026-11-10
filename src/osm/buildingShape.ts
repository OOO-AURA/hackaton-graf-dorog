/**
 * Building outlines as plain geometry, in local metres (x east, y north), open rings without the
 * closing point. Everything here is pure so it can be tested; osm/buildingEdit.ts turns it into
 * nodes and ways.
 *
 * A building's angle is the compass bearing of its long axis, degrees clockwise from north, in
 * [0, 180): a building and the same one turned half a turn are one shape.
 */

export type P = [number, number];

export interface BuildingTemplate {
  readonly id: 'small' | 'medium' | 'large';
  readonly label: string;
  /** Across the long axis, metres. */
  readonly width: number;
  /** Along the long axis, metres. */
  readonly length: number;
  readonly levels: number;
}

/** The three ready-made buildings; everything else is shaped by hand from these. */
export const BUILDING_TEMPLATES: readonly BuildingTemplate[] = [
  { id: 'small', label: 'Малое', width: 12, length: 12, levels: 2 },
  { id: 'medium', label: 'Среднее', width: 20, length: 40, levels: 5 },
  { id: 'large', label: 'Большое', width: 30, length: 60, levels: 9 },
];

const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
/** Unit vector of a compass bearing. */
const axis = (bearing: number): P => [Math.sin(rad(bearing)), Math.cos(rad(bearing))];
const normAngle = (a: number) => ((a % 180) + 180) % 180;

export const centroid = (ring: readonly P[]): P => {
  // Area centroid; falls back to the mean of the points for a degenerate ring.
  let a = 0; let cx = 0; let cy = 0;
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length];
    const c = p[0] * q[1] - q[0] * p[1];
    a += c; cx += (p[0] + q[0]) * c; cy += (p[1] + q[1]) * c;
  });
  if (Math.abs(a) < 1e-9) return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
  return [cx / (3 * a), cy / (3 * a)];
};

export const area = (ring: readonly P[]) => Math.abs(ring.reduce((s, p, i) => {
  const q = ring[(i + 1) % ring.length];
  return s + p[0] * q[1] - q[0] * p[1];
}, 0)) / 2;

/** A rectangle `width` × `length` around `center`, its long axis on bearing `angle`. Corners counter-clockwise. */
export function rectangle(center: P, width: number, length: number, angle: number): P[] {
  const u = axis(angle);
  const v: P = [u[1], -u[0]];
  const [hl, hw] = [length / 2, width / 2];
  const at = (a: number, b: number): P => [center[0] + u[0] * a + v[0] * b, center[1] + u[1] * a + v[1] * b];
  return [at(-hl, -hw), at(-hl, hw), at(hl, hw), at(hl, -hw)];
}

export const translate = (ring: readonly P[], d: P): P[] => ring.map((p) => [p[0] + d[0], p[1] + d[1]]);

/** Turned by `delta` degrees clockwise (like a compass bearing) around `center`. */
export function rotate(ring: readonly P[], delta: number, center: P = centroid(ring)): P[] {
  const [s, c] = [Math.sin(rad(delta)), Math.cos(rad(delta))];
  return ring.map((p) => {
    const [x, y] = [p[0] - center[0], p[1] - center[1]];
    return [center[0] + x * c + y * s, center[1] - x * s + y * c];
  });
}

/** In the frame of a bearing: `a` along the axis, `b` across it (to the right). */
const toAxis = (p: P, o: P, angle: number): P => {
  const u = axis(angle);
  const [x, y] = [p[0] - o[0], p[1] - o[1]];
  return [x * u[0] + y * u[1], x * u[1] - y * u[0]];
};
const fromAxis = (q: P, o: P, angle: number): P => {
  const u = axis(angle);
  return [o[0] + q[0] * u[0] + q[1] * u[1], o[1] + q[0] * u[1] - q[1] * u[0]];
};

export interface Box {
  readonly center: P;
  /** Bearing of the long side, [0, 180). */
  readonly angle: number;
  readonly width: number;
  readonly length: number;
}

/**
 * The smallest rectangle around the outline whose sides follow one of its edges: for a
 * rectangle its own sides, for a Г or П shape the sides of the block it fills.
 */
export function orientedBox(ring: readonly P[]): Box {
  let best: Box | null = null;
  let bestArea = Infinity;
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length];
    if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-6) return;
    const bearing = normAngle(deg(Math.atan2(q[0] - p[0], q[1] - p[1])));
    const pts = ring.map((r) => toAxis(r, [0, 0], bearing));
    const [a0, a1] = [Math.min(...pts.map((t) => t[0])), Math.max(...pts.map((t) => t[0]))];
    const [b0, b1] = [Math.min(...pts.map((t) => t[1])), Math.max(...pts.map((t) => t[1]))];
    const s = (a1 - a0) * (b1 - b0);
    if (s < bestArea - 1e-6) {
      bestArea = s;
      const center = fromAxis([(a0 + a1) / 2, (b0 + b1) / 2], [0, 0], bearing);
      const [la, lb] = [a1 - a0, b1 - b0];
      best = la >= lb ? { center, angle: bearing, width: lb, length: la } : { center, angle: normAngle(bearing + 90), width: la, length: lb };
    }
  });
  return best ?? { center: ring[0] ?? [0, 0], angle: 0, width: 0, length: 0 };
}

/** Stretched along its own axes so its box becomes `width` × `length`; the centre stays. */
export function resize(ring: readonly P[], width: number, length: number): P[] {
  const box = orientedBox(ring);
  const [kl, kw] = [box.length ? length / box.length : 1, box.width ? width / box.width : 1];
  return ring.map((p) => {
    const q = toAxis(p, box.center, box.angle);
    return fromAxis([q[0] * kl, q[1] * kw], box.center, box.angle);
  });
}

/** Side `i` (from point i to i+1) moved along its normal by the part of `drag` across it. */
export function moveEdge(ring: readonly P[], i: number, drag: P): P[] {
  const j = (i + 1) % ring.length;
  const [a, b] = [ring[i], ring[j]];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const n: P = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
  const k = drag[0] * n[0] + drag[1] * n[1];
  return ring.map((p, idx) => (idx === i || idx === j ? [p[0] + n[0] * k, p[1] + n[1] * k] : p));
}

export const insertVertex = (ring: readonly P[], after: number, p: P): P[] => [...ring.slice(0, after + 1), p, ...ring.slice(after + 1)];

export const removeVertex = (ring: readonly P[], i: number): P[] => (ring.length <= 3 ? [...ring] : ring.filter((_, k) => k !== i));

/**
 * Point `p` for vertex `i` pulled onto the building's axes through its neighbours, where it is
 * within `tolerance` metres of them: dragged corners keep right angles unless pulled clearly off.
 */
export function snapCorner(ring: readonly P[], i: number, p: P, tolerance: number, angle = orientedBox(ring).angle): P {
  const prev = ring[(i - 1 + ring.length) % ring.length];
  const next = ring[(i + 1) % ring.length];
  const o = prev;
  const q = toAxis(p, o, angle);
  const cands = [toAxis(prev, o, angle), toAxis(next, o, angle)];
  const snap = (k: 0 | 1) => {
    let best = q[k];
    let d = tolerance;
    for (const c of cands) if (Math.abs(c[k] - q[k]) < d) { d = Math.abs(c[k] - q[k]); best = c[k]; }
    return best;
  };
  return fromAxis([snap(0), snap(1)], o, angle);
}

/**
 * Right angles everywhere: every side turned onto the building's axis or across it, whichever is
 * nearer, and runs of sides in one direction lined up. Corners that were already square stay put.
 */
export function squareUp(ring: readonly P[]): P[] {
  const box = orientedBox(ring);
  const q = ring.map((p) => toAxis(p, box.center, box.angle));
  const n = q.length;
  // Which axis each side follows: 0 along (its points share b), 1 across (they share a).
  const dir = q.map((p, i) => {
    const r = q[(i + 1) % n];
    return Math.abs(r[0] - p[0]) >= Math.abs(r[1] - p[1]) ? 0 : 1;
  });
  const out = q.map((p) => [...p] as P);
  for (const d of [0, 1] as const) {
    // Sides along d keep coordinate 1 - d fixed; chains of them share one value.
    const fixed = 1 - d;
    const visited = new Array(n).fill(false);
    for (let s = 0; s < n; s += 1) {
      if (dir[s] !== d || visited[s]) continue;
      // Walk back to the start of the chain, then forward over it.
      let start = s;
      let guard = 0;
      while (dir[(start - 1 + n) % n] === d && guard++ < n) start = (start - 1 + n) % n;
      const members: number[] = [];
      let e = start;
      guard = 0;
      while (dir[e] === d && !visited[e] && guard++ < n) { visited[e] = true; members.push(e); e = (e + 1) % n; }
      const pts = [...new Set(members.flatMap((m) => [m, (m + 1) % n]))];
      const mean = pts.reduce((acc, k) => acc + q[k][fixed], 0) / pts.length;
      pts.forEach((k) => { out[k][fixed] = mean; });
    }
  }
  // Points in the middle of a straight run are no longer corners: drop them.
  const res = out.map((p) => fromAxis(p, box.center, box.angle));
  return res.filter((p, i) => {
    if (res.length <= 4) return true;
    const a = res[(i - 1 + res.length) % res.length];
    const b = res[(i + 1) % res.length];
    const cross = (p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0]);
    return Math.abs(cross) > 1e-3 * Math.hypot(b[0] - a[0], b[1] - a[1]);
  });
}

/** Whether two sides of the outline cross: Webots cannot build such a building. */
export function selfIntersects(ring: readonly P[]): boolean {
  const n = ring.length;
  const cross = (a: P, b: P, c: P) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      const [a, b, c, d] = [ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n]];
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return true;
    }
  }
  return false;
}

/** Whether `p` is inside the outline. */
export function contains(ring: readonly P[], p: P): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [a, b] = [ring[i], ring[j]];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Bearing of a segment, [0, 180). */
export const bearingOf = (a: P, b: P) => normAngle(deg(Math.atan2(b[0] - a[0], b[1] - a[1])));
