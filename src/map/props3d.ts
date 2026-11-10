import { armsAt } from '../osm/lanes';
import type { SignKind } from '../osm/signs';
import { isDrivable } from '../osm/tags';
import type { OsmDoc, OsmWay } from '../osm/types';

/**
 * Very low-poly street props for the 3D view: road signs, traffic lights and vehicle models.
 * Everything is a few convex solids written straight into the vertex layout of mesh3d.ts
 * (x, y, z, r, g, b, id, nx, ny, nz, shade, pick), in local metres: x east, y south, z up.
 *
 * Models are built in their own frame: x forward, y to the left, z up. A vehicle's front bumper
 * is at x = 0 and the body runs back to x = -length, like SUMO reports positions.
 */

export type P2 = [number, number];
type V3 = [number, number, number];
type Rgb = readonly [number, number, number];
export type Sink = { push(...v: number[]): void };

const POLE: Rgb = [0.56, 0.58, 0.6];
const HOUSING: Rgb = [0.17, 0.18, 0.19];
const SIGN_BACK: Rgb = [0.62, 0.64, 0.66];
const WHITE: Rgb = [0.96, 0.96, 0.95];
const RED: Rgb = [0.84, 0.15, 0.12];
const BLUE: Rgb = [0.12, 0.36, 0.72];
const YELLOW: Rgb = [0.96, 0.76, 0.1];
const INK: Rgb = [0.1, 0.1, 0.1];
// Lamps glow dimly: the props show where lights stand, not their phase.
const LAMP_RED: Rgb = [0.62, 0.14, 0.12];
const LAMP_AMBER: Rgb = [0.66, 0.46, 0.1];
const LAMP_GREEN: Rgb = [0.12, 0.52, 0.28];
const WHEEL: Rgb = [0.2, 0.2, 0.21];
/** One colour for every vehicle: models are told apart by shape, not paint. */
export const VEHICLE_BODY: Rgb = [0.68, 0.71, 0.76];

/** Writes model-frame faces into the scene at `origin`, turned so that model x points along `fwd`. */
class Writer {
  private readonly l: P2;
  constructor(private readonly out: Sink, private readonly o: P2, private readonly f: P2) {
    // Left of the forward direction in the y-south frame.
    this.l = [f[1], -f[0]];
  }
  private world(v: V3): V3 {
    return [this.o[0] + v[0] * this.f[0] + v[1] * this.l[0], this.o[1] + v[0] * this.f[1] + v[1] * this.l[1], v[2]];
  }
  /** Convex polygon with its outward normal in the model frame. */
  face(pts: readonly V3[], c: Rgb, n: V3) {
    const wn: V3 = [n[0] * this.f[0] + n[1] * this.l[0], n[0] * this.f[1] + n[1] * this.l[1], n[2]];
    const len = Math.hypot(wn[0], wn[1], wn[2]) || 1;
    // mesh3d lights walls with the inward horizontal normal (MapLibre's convention) and roofs with +z.
    const ln: V3 = [-wn[0] / len, -wn[1] / len, wn[2] / len];
    const w = pts.map((p) => this.world(p));
    for (let i = 1; i < w.length - 1; i += 1) {
      for (const v of [w[0], w[i], w[i + 1]]) this.out.push(v[0], v[1], v[2], c[0], c[1], c[2], 0, ln[0], ln[1], ln[2], 1, 0);
    }
  }
  /** Turns the frame by `angle` (left positive) about the model point (x, 0). */
  child(x: number, angle: number): Writer {
    const at: P2 = [this.o[0] + x * this.f[0], this.o[1] + x * this.f[1]];
    const [c, s] = [Math.cos(angle), Math.sin(angle)];
    return new Writer(this.out, at, [this.f[0] * c + this.l[0] * s, this.f[1] * c + this.l[1] * s]);
  }
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const mean = (pts: readonly V3[]): V3 => {
  const s: V3 = [0, 0, 0];
  pts.forEach((p) => { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; });
  return [s[0] / pts.length, s[1] / pts.length, s[2] / pts.length];
};

/** Normal of a polygon pointing away from `inside`. */
function outward(poly: readonly V3[], inside: V3): V3 {
  let n: V3 = [0, 0, 0];
  for (let i = 1; i < poly.length - 1 && Math.hypot(...n) < 1e-9; i += 1) n = cross(sub(poly[i], poly[0]), sub(poly[i + 1], poly[0]));
  return dot(n, sub(mean(poly), inside)) < 0 ? [-n[0], -n[1], -n[2]] : n;
}

/**
 * Convex solid lofted through rings of equal size, from the bottom up. The top is closed; the
 * bottom only when `floor` is set, as the camera never looks from below.
 */
function loft(w: Writer, rings: readonly (readonly V3[])[], c: Rgb, floor = false) {
  const centre = mean(rings.flat());
  for (let k = 0; k < rings.length - 1; k += 1) {
    const [a, b] = [rings[k], rings[k + 1]];
    for (let i = 0; i < a.length; i += 1) {
      const j = (i + 1) % a.length;
      const q: V3[] = [a[i], a[j], b[j], b[i]];
      w.face(q, c, outward(q, centre));
    }
  }
  const top = rings[rings.length - 1];
  w.face(top, c, outward(top, centre));
  if (floor) w.face(rings[0], c, outward(rings[0], centre));
}

const rect = (x0: number, x1: number, half: number, z: number, y = 0): V3[] => [[x0, y - half, z], [x1, y - half, z], [x1, y + half, z], [x0, y + half, z]];

/** Box from x0 to x1, `half` either side of y, between z0 and z1, top edges cut by `r`. */
function box(w: Writer, x0: number, x1: number, half: number, z0: number, z1: number, c: Rgb, r = 0, y = 0) {
  const rings = r > 0
    ? [rect(x0, x1, half, z0, y), rect(x0, x1, half, z1 - r, y), rect(x0 + r, x1 - r, half - r, z1, y)]
    : [rect(x0, x1, half, z0, y), rect(x0, x1, half, z1, y)];
  loft(w, rings, c);
}

/** Square beam of side `t` from a to b. */
function beam(w: Writer, a: V3, b: V3, t: number, c: Rgb) {
  const d = sub(b, a);
  const len = Math.hypot(...d) || 1;
  const dn: V3 = [d[0] / len, d[1] / len, d[2] / len];
  let u = cross(dn, [0, 0, 1]);
  if (Math.hypot(...u) < 1e-6) u = [1, 0, 0];
  const ul = Math.hypot(...u);
  u = [(u[0] / ul) * (t / 2), (u[1] / ul) * (t / 2), (u[2] / ul) * (t / 2)];
  const v = cross(dn, u);
  const ring = (p: V3): V3[] => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [p[0] + u[0] * i + v[0] * j, p[1] + u[1] * i + v[1] * j, p[2] + u[2] * i + v[2] * j] as V3);
  loft(w, [ring(a), ring(b)], c, true);
}

/** Flat polygon facing +x at depth x, from (y, z) points. */
function plate(w: Writer, x: number, pts: readonly (readonly [number, number])[], c: Rgb) {
  w.face(pts.map(([y, z]) => [x, y, z] as V3), c, [1, 0, 0]);
}

const polygon = (n: number, r: number, cy: number, cz: number, turn = 0): [number, number][] =>
  Array.from({ length: n }, (_, i) => {
    const a = turn + (i * 2 * Math.PI) / n;
    return [cy - r * Math.cos(a), cz + r * Math.sin(a)];
  });

// ---------------------------------------------------------------------------------------------
// Vehicles

export type VehicleKind = 'car' | 'van' | 'truck' | 'semi' | 'bus' | 'trolleybus' | 'tram' | 'utility' | 'pedestrian';

/** Real outer sizes, metres. */
export const VEHICLE_SIZE: Readonly<Record<VehicleKind, { length: number; width: number; height: number }>> = {
  car: { length: 4.5, width: 1.8, height: 1.5 },
  van: { length: 5.5, width: 2.0, height: 2.3 },
  truck: { length: 8, width: 2.5, height: 3.2 },
  semi: { length: 16.5, width: 2.5, height: 4 },
  bus: { length: 12, width: 2.55, height: 3 },
  trolleybus: { length: 12, width: 2.55, height: 3.3 },
  tram: { length: 30, width: 2.5, height: 3.5 },
  utility: { length: 9, width: 2.5, height: 3.3 },
  pedestrian: { length: 0.5, width: 0.5, height: 1.7 },
};

/** Every model, in the order they are listed in the plan. */
export const VEHICLE_KINDS: readonly VehicleKind[] = Object.keys(VEHICLE_SIZE) as VehicleKind[];

/** Pairs of wheels at the given x, as dark blocks under the body. */
function wheels(w: Writer, xs: readonly number[], half: number, d: number) {
  for (const x of xs) for (const s of [-1, 1]) box(w, x - d / 2, x + d / 2, 0.13, 0, d, WHEEL, 0, s * (half - 0.14));
}

function car(w: Writer, c: Rgb) {
  wheels(w, [-0.8, -3.6], 0.88, 0.62);
  loft(w, [
    rect(-4.42, -0.08, 0.86, 0.28),
    rect(-4.5, 0, 0.9, 0.45),
    rect(-4.5, 0, 0.9, 0.82),
    rect(-4.4, -1.3, 0.86, 0.95),
    rect(-3.85, -2.3, 0.72, 1.5),
  ], c);
}

function van(w: Writer, c: Rgb) {
  wheels(w, [-0.85, -4.4], 0.98, 0.68);
  loft(w, [
    rect(-5.42, -0.08, 0.96, 0.32),
    rect(-5.5, 0, 1.0, 0.5),
    rect(-5.5, 0, 1.0, 1.05),
    rect(-5.5, -0.6, 1.0, 1.3),
    rect(-5.5, -1.3, 1.0, 2.18),
    rect(-5.38, -1.5, 0.88, 2.3),
  ], c);
}

function truck(w: Writer, c: Rgb) {
  wheels(w, [-1.2, -5.4, -6.6], 1.22, 0.95);
  box(w, -7.6, -0.4, 0.9, 0.55, 1.0, c);
  loft(w, [rect(-2.2, 0, 1.2, 0.6), rect(-2.2, 0, 1.2, 2.5), rect(-2.15, -0.25, 1.12, 2.9)], c);
  box(w, -8, -2.35, 1.25, 1.0, 3.2, c, 0.12);
}

/** Tractor of the semi: the trailer hangs on its fifth wheel at x = -3.7. */
function tractor(w: Writer, c: Rgb) {
  wheels(w, [-1.3, -4.2, -5.4], 1.22, 1.0);
  box(w, -5.9, -0.4, 0.9, 0.6, 1.15, c);
  loft(w, [rect(-2.3, 0, 1.22, 0.65), rect(-2.3, 0, 1.22, 2.6), rect(-2.25, -0.3, 1.12, 3.2), rect(-2.1, -0.5, 1.0, 3.7)], c);
}

const SEMI_HITCH = -3.7;
function trailer(w: Writer, c: Rgb) {
  // Trailer frame: x = 0 is the king pin; 14 m box, front 1.2 m ahead of the pin.
  wheels(w, [-9.0, -10.3, -11.6], 1.22, 1.0);
  box(w, -12.8, 1.2, 1.25, 1.15, 4.0, c, 0.1);
}

function bus(w: Writer, c: Rgb, height = 3.0) {
  wheels(w, [-2.6, -9.3], 1.24, 0.95);
  loft(w, [
    rect(-11.9, -0.1, 1.24, 0.35),
    rect(-12, 0, 1.275, 0.55),
    rect(-12, 0, 1.275, 1.2),
    rect(-12, -0.12, 1.275, height - 0.2),
    rect(-11.85, -0.35, 1.13, height),
  ], c);
}

function trolleybus(w: Writer, c: Rgb) {
  bus(w, c, 3.0);
  box(w, -6.0, -2.4, 0.7, 3.0, 3.3, c, 0.08);
  // Raised trolley poles from the roof back up to the overhead wires.
  for (const y of [-0.3, 0.3]) beam(w, [-3.0, y, 3.3], [-8.8, y * 1.3, 5.6], 0.08, c);
}

/** One tram section: `nose` shapes a cab end. x = 0 is the front joint (or nose). */
function tramSection(w: Writer, c: Rgb, nose: boolean, tail: boolean, pantograph: boolean) {
  // Sections stand 10 m apart with a 0.2 m gap at the joints; the tail closes the full 30 m.
  const [x0, x1] = [tail ? -10 : -9.8, 0];
  wheels(w, [-1.8, -8.0], 1.2, 0.7);
  const front = nose ? 0.5 : 0;
  const back = tail ? 0.5 : 0;
  loft(w, [
    rect(x0 + back * 0.4, x1 - front * 0.4, 1.2, 0.35),
    rect(x0, x1, 1.25, 0.6),
    rect(x0, x1 - front * 0.3, 1.25, 2.9),
    rect(x0 + back, x1 - front, 1.1, 3.25),
  ], c);
  if (pantograph) {
    box(w, -6.6, -3.2, 0.75, 3.25, 3.5, c, 0.06);
    // Low-poly diamond: two arms up to a collector bar.
    beam(w, [-6.0, 0, 3.5], [-4.9, 0, 4.6], 0.08, c);
    beam(w, [-3.8, 0, 3.5], [-4.9, 0, 4.6], 0.08, c);
    beam(w, [-4.9, -0.8, 4.65], [-4.9, 0.8, 4.65], 0.1, c);
  }
}

function utility(w: Writer, c: Rgb) {
  wheels(w, [-1.3, -6.4, -7.6], 1.22, 1.0);
  box(w, -8.6, -0.4, 0.9, 0.55, 1.05, c);
  loft(w, [rect(-2.3, 0, 1.2, 0.6), rect(-2.3, 0, 1.2, 2.55), rect(-2.25, -0.3, 1.1, 2.95)], c);
  // Rounded body: steep cut edges all round, a slanted hopper at the back.
  loft(w, [
    rect(-8.4, -2.45, 1.25, 1.05),
    rect(-8.4, -2.45, 1.25, 2.6),
    rect(-8.2, -2.6, 1.0, 3.2),
    rect(-7.8, -2.8, 0.75, 3.3),
  ], c);
  loft(w, [rect(-9, -8.4, 1.2, 0.9), rect(-8.8, -8.4, 1.15, 2.4), rect(-8.55, -8.4, 1.0, 3.0)], c);
}

function pedestrian(w: Writer, c: Rgb) {
  const ring = (r: number, z: number): V3[] => polygon(8, r, 0, 0, Math.PI / 8).map(([y, x]) => [x - 0.25, y, z] as V3);
  loft(w, [ring(0.12, 0.02), ring(0.22, 0.18), ring(0.25, 0.45), ring(0.25, 1.4), ring(0.18, 1.6), ring(0.08, 1.7)], c);
}

/**
 * Writes a vehicle with its front bumper at `at`, heading along the unit vector `fwd` (local
 * metres). `bend` turns each following unit of a semi or tram left by that angle, radians.
 */
export function addVehicle(out: Sink, kind: VehicleKind, at: P2, fwd: P2, bend = 0, color: Rgb = VEHICLE_BODY): void {
  const w = new Writer(out, at, fwd);
  switch (kind) {
    case 'car': car(w, color); break;
    case 'van': van(w, color); break;
    case 'truck': truck(w, color); break;
    case 'semi': tractor(w, color); trailer(w.child(SEMI_HITCH, bend), color); break;
    case 'bus': bus(w, color); break;
    case 'trolleybus': trolleybus(w, color); break;
    case 'tram': {
      tramSection(w, color, true, false, false);
      const mid = w.child(-10, bend);
      tramSection(mid, color, false, false, true);
      tramSection(mid.child(-10, bend), color, false, true, false);
      break;
    }
    case 'utility': utility(w, color); break;
    case 'pedestrian': pedestrian(w, color); break;
  }
}

// ---------------------------------------------------------------------------------------------
// Signs and lights. Their frame: x towards the drivers they face, so the face is at x > 0.

const SIGN_Z = 2.3;

function signFace(w: Writer, kind: SignKind) {
  const z = SIGN_Z;
  const layers: [Rgb, [number, number][]][] = [];
  const tri = (s: number, down: boolean): [number, number][] => {
    const r = 0.5 * s;
    return polygon(3, r, 0, z, down ? -Math.PI / 2 : Math.PI / 2);
  };
  switch (kind) {
    case 'give_way': layers.push([WHITE, tri(1, true)], [RED, tri(0.92, true)], [WHITE, tri(0.58, true)]); break;
    case 'stop': layers.push([WHITE, polygon(8, 0.4, 0, z, Math.PI / 8)], [RED, polygon(8, 0.37, 0, z, Math.PI / 8)]); break;
    case 'main_road': layers.push([INK, polygon(4, 0.42, 0, z)], [WHITE, polygon(4, 0.4, 0, z)], [YELLOW, polygon(4, 0.27, 0, z)]); break;
    case 'crossing': layers.push([BLUE, polygon(4, 0.42, 0, z, Math.PI / 4)], [WHITE, polygon(3, 0.25, 0, z - 0.03, Math.PI / 2)]); break;
  }
  w.face(layers[0][1].map(([y, zz]) => [0.045, y, zz] as V3), SIGN_BACK, [-1, 0, 0]);
  layers.forEach(([c, pts], i) => plate(w, 0.05 + i * 0.008, pts, c));
}

/** Sign on its pole at `at`, facing drivers who travel along `travel`. */
export function addSign(out: Sink, kind: SignKind, at: P2, travel: P2): void {
  const w = new Writer(out, at, [-travel[0], -travel[1]]);
  box(w, -0.04, 0.04, 0.04, 0, SIGN_Z + 0.25, POLE);
  signFace(w, kind);
}

function lamps(w: Writer, x: number, zs: readonly number[], colors: readonly Rgb[], r: number) {
  zs.forEach((z, i) => plate(w, x, polygon(8, r, 0, z, Math.PI / 8), colors[i]));
}

/** Traffic light for drivers going along `travel`, standing at the road edge `at`. */
export function addTrafficLight(out: Sink, at: P2, travel: P2, overhang = 0): void {
  const w = new Writer(out, at, [-travel[0], -travel[1]]);
  if (overhang <= 0) {
    box(w, -0.06, 0.06, 0.06, 0, 3.1, POLE);
    box(w, 0.06, 0.32, 0.16, 2.1, 3.0, HOUSING, 0.03);
    lamps(w, 0.325, [2.84, 2.55, 2.26], [LAMP_RED, LAMP_AMBER, LAMP_GREEN], 0.1);
    return;
  }
  // Cantilever over the lanes: the road lies to the right of a pole that faces the drivers.
  box(w, -0.1, 0.1, 0.1, 0, 6.3, POLE);
  beam(w, [0, 0, 6.0], [0, -overhang, 6.0], 0.12, POLE);
  beam(w, [0, -overhang * 0.35, 6.0], [0, 0, 5.2], 0.07, POLE);
  for (const y of [-overhang, -overhang * 0.5]) {
    box(w, 0.0, 0.26, 0.16, 4.95, 5.85, HOUSING, 0.03, y);
    [5.69, 5.4, 5.11].forEach((z, i) => plate(w, 0.265, polygon(8, 0.1, y, z, Math.PI / 8), [LAMP_RED, LAMP_AMBER, LAMP_GREEN][i]));
  }
}

/** Pedestrian light at the kerb `at`, facing across the road along `toward`. */
export function addPedestrianLight(out: Sink, at: P2, toward: P2): void {
  const w = new Writer(out, at, toward);
  box(w, -0.05, 0.05, 0.05, 0, 2.55, POLE);
  box(w, 0.05, 0.28, 0.14, 1.9, 2.5, HOUSING, 0.03);
  lamps(w, 0.285, [2.35, 2.05], [LAMP_RED, LAMP_GREEN], 0.09);
}

// ---------------------------------------------------------------------------------------------
// Placement from the document

/** Distance of a light from the edge of the carriageway, metres. */
const SIDE = 1.5;
/** An approach with this many lanes gets its lights on a cantilever over the road. */
const CANTILEVER_LANES = 3;

const unit = (a: P2, b: P2): P2 => {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
};
/** Right of the travel direction in the y-south frame. */
const rightOf = (t: P2): P2 => [-t[1], t[0]];

export type PropInput = {
  doc: OsmDoc;
  local: (nodeId: string) => P2 | null;
  roadWidth: (tags: Record<string, string>) => number;
  /** Signs from signPoints, already in local metres with the travel direction they face. */
  signs: readonly { sign: SignKind; at: P2; travel: P2 }[];
};

/** Signs, traffic lights and pedestrian lights of the whole document. */
export function addStreetProps(out: Sink, { doc, local, roadWidth, signs }: PropInput): void {
  for (const s of signs) addSign(out, s.sign, s.at, s.travel);

  const drivableAt = new Map<string, OsmWay[]>();
  for (const w of Object.values(doc.ways)) {
    if (!isDrivable(w.tags)) continue;
    for (const r of new Set(w.refs)) {
      const list = drivableAt.get(r);
      if (list) list.push(w); else drivableAt.set(r, [w]);
    }
  }

  for (const [id, n] of Object.entries(doc.nodes)) {
    const p = local(id);
    if (!p) continue;
    if (n.tags.highway === 'traffic_signals') {
      const arms = armsAt(doc, id);
      const junction = arms.length >= 3;
      const back = junction ? Math.max(...arms.map((a) => roadWidth(doc.ways[a.wayId].tags) / 2)) + 3 : 0;
      const only = n.tags['traffic_signals:direction'] ?? n.tags.direction;
      for (const arm of arms) {
        if (arm.lanesIn <= 0) continue;
        // Coming in along an arm that leaves forward (+1) is backward travel on the way.
        if (only === 'forward' && arm.step === 1) continue;
        if (only === 'backward' && arm.step === -1) continue;
        const way = doc.ways[arm.wayId];
        const nb = local(way.refs[arm.index + arm.step]);
        if (!nb) continue;
        const t = unit(nb, p);
        const seg = Math.hypot(p[0] - nb[0], p[1] - nb[1]);
        const k = Math.min(back, seg * 0.8);
        const side = roadWidth(way.tags) / 2 + SIDE;
        const r = rightOf(t);
        const at: P2 = [p[0] - t[0] * k + r[0] * side, p[1] - t[1] * k + r[1] * side];
        const overhang = arm.lanesIn >= CANTILEVER_LANES ? Math.min(arm.lanesIn * 3.5 * 0.7, side + 3.5) : 0;
        addTrafficLight(out, at, t, overhang);
      }
      continue;
    }
    if (n.tags.highway === 'crossing' && n.tags.crossing === 'traffic_signals') {
      const way = drivableAt.get(id)?.[0];
      if (!way) continue;
      const i = way.refs.indexOf(id);
      const a = local(way.refs[Math.max(0, i - 1)]);
      const b = local(way.refs[Math.min(way.refs.length - 1, i + 1)]);
      if (!a || !b || a === b) continue;
      const t = unit(a, b);
      const r = rightOf(t);
      const side = roadWidth(way.tags) / 2 + 0.8;
      for (const s of [1, -1]) addPedestrianLight(out, [p[0] + r[0] * side * s, p[1] + r[1] * side * s], [-r[0] * s, -r[1] * s]);
    }
  }
}
