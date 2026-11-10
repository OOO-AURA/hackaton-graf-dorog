import type { Feature, FeatureCollection, Polygon } from 'geojson';
import { VEHICLE_SIZE, type VehicleKind } from '../map/props3d';
import { bandColor } from './store';
import { STRIDE, type SimFrame, type SimResult } from './types';

/**
 * Where every vehicle of a micro run stands at a moment, as the 3D models and the 2D top view
 * need it: model, front bumper (SUMO's position), heading and how far a trailer is bent.
 */

export type VehiclePose = {
  kind: VehicleKind;
  lon: number;
  lat: number;
  /** SUMO angle: degrees clockwise from north. */
  angle: number;
  /** Turn of the trailer (or each tram section) left of the unit in front, radians. */
  bend: number;
  kmh: number;
};

/** SUMO vehicle types of sim.rs to models. Not listed: a car. */
const KIND_OF: Readonly<Record<string, VehicleKind>> = {
  car: 'car', van: 'van', truck: 'truck', trailer: 'semi', bus: 'bus', bus18: 'bus', ptbus: 'bus',
  trolleybus: 'trolleybus', tram: 'tram', utility: 'utility', ped: 'pedestrian',
};
export const kindOf = (type: string): VehicleKind => KIND_OF[type] ?? 'car';

/** Where the following unit hangs (metres behind the front of the unit) and its length to the axle it follows on. */
const ARTICULATION: Partial<Record<VehicleKind, { hitch: number; reach: number; max: number }>> = {
  // A semi can fold up to a right angle on a U-turn; tram joints bend much less.
  semi: { hitch: 3.7, reach: 9.5, max: 1.5 },
  tram: { hitch: 10, reach: 10, max: 0.6 },
};
/** Frames looked back for the path an articulated vehicle has come along. */
const TRAIL_FRAMES = 40;

const M_PER_DEG = (Math.PI / 180) * 6_371_000;

const index = new WeakMap<SimFrame, Map<number, number>>();
function offsets(f: SimFrame): Map<number, number> {
  let m = index.get(f);
  if (!m) {
    m = new Map();
    for (let j = 0; j < f.v.length; j += STRIDE) m.set(f.v[j], j);
    index.set(f, m);
  }
  return m;
}

/** Shortest turn from a to b, degrees. */
const turn = (a: number, b: number) => ((((b - a) % 360) + 540) % 360) - 180;

/**
 * Bend of the trailer from the path behind: the trailer points from the place the front passed
 * `reach` metres behind the hitch towards the hitch.
 */
function bendFromTrail(frames: readonly SimFrame[], from: number, id: number, lon: number, lat: number, angle: number, kind: VehicleKind): number {
  const a = ARTICULATION[kind];
  if (!a) return 0;
  const kx = M_PER_DEG * Math.cos((lat * Math.PI) / 180);
  const rad = (angle * Math.PI) / 180;
  // Metres east and north.
  const f: [number, number] = [Math.sin(rad), Math.cos(rad)];
  const hitch: [number, number] = [-f[0] * a.hitch, -f[1] * a.hitch];
  const away = (q: [number, number]) => Math.hypot(hitch[0] - q[0], hitch[1] - q[1]);
  // Frames are seconds apart, so the point is found between the two trail points around it.
  let prev: [number, number] = [0, 0];
  for (let i = from; i >= Math.max(0, from - TRAIL_FRAMES); i -= 1) {
    const j = offsets(frames[i]).get(id);
    if (j === undefined) return 0;
    const v = frames[i].v;
    const p: [number, number] = [(v[j + 1] - lon) * kx, (v[j + 2] - lat) * M_PER_DEG];
    if (away(p) < a.reach) { prev = p; continue; }
    let [lo, hi] = [0, 1];
    for (let n = 0; n < 16; n += 1) {
      const m = (lo + hi) / 2;
      if (away([prev[0] + (p[0] - prev[0]) * m, prev[1] + (p[1] - prev[1]) * m]) < a.reach) lo = m; else hi = m;
    }
    const q: [number, number] = [prev[0] + (p[0] - prev[0]) * hi, prev[1] + (p[1] - prev[1]) * hi];
    const d: [number, number] = [hitch[0] - q[0], hitch[1] - q[1]];
    // Left of the heading, east-north frame.
    const left: [number, number] = [-f[1], f[0]];
    const b = Math.atan2(d[0] * left[0] + d[1] * left[1], d[0] * f[0] + d[1] * f[1]);
    return Math.max(-a.max, Math.min(a.max, b));
  }
  return 0;
}

/** Vehicle poses at time t, interpolated between the two surrounding FCD frames. */
export function vehiclePoses(r: SimResult, t: number): VehiclePose[] {
  const frames = r.frames;
  if (!frames.length) return [];
  let i = frames.findIndex((f) => f.t > t);
  if (i === -1) i = frames.length;
  const ia = Math.max(0, i - 1);
  const a = frames[ia];
  const b = frames[Math.min(frames.length - 1, i)];
  const k = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
  const next = offsets(b);
  const out: VehiclePose[] = [];
  for (let j = 0; j < a.v.length; j += STRIDE) {
    const id = a.v[j];
    const nj = next.get(id);
    const v = a.v;
    const kind = kindOf(r.types[v[j + 5]] ?? 'car');
    const lon = nj === undefined ? v[j + 1] : v[j + 1] + (b.v[nj + 1] - v[j + 1]) * k;
    const lat = nj === undefined ? v[j + 2] : v[j + 2] + (b.v[nj + 2] - v[j + 2]) * k;
    const angle = nj === undefined ? v[j + 3] : v[j + 3] + turn(v[j + 3], b.v[nj + 3]) * k;
    const bend = bendFromTrail(frames, ia, id, lon, lat, angle, kind);
    out.push({ kind, lon, lat, angle, bend, kmh: v[j + 4] * 3.6 });
  }
  return out;
}

/** Outline of each unit of a vehicle in metres east and north of its front bumper. */
export function unitOutlines(p: Pick<VehiclePose, 'kind' | 'angle' | 'bend'>): [number, number][][] {
  const { length, width } = VEHICLE_SIZE[p.kind];
  const half = width / 2;
  const rad = (p.angle * Math.PI) / 180;
  let f: [number, number] = [Math.sin(rad), Math.cos(rad)];
  let origin: [number, number] = [0, 0];
  const rect = (x0: number, x1: number) => {
    const l: [number, number] = [-f[1], f[0]];
    return [[x0, -half], [x1, -half], [x1, half], [x0, half], [x0, -half]].map(([x, y]) => [origin[0] + f[0] * x + l[0] * y, origin[1] + f[1] * x + l[1] * y] as [number, number]);
  };
  const rotate = (by: number) => {
    const l: [number, number] = [-f[1], f[0]];
    const [c, s] = [Math.cos(by), Math.sin(by)];
    f = [f[0] * c + l[0] * s, f[1] * c + l[1] * s];
  };
  if (p.kind === 'semi') {
    const units = [rect(-5.9, 0)];
    origin = [-f[0] * 3.7, -f[1] * 3.7];
    rotate(p.bend);
    units.push(rect(-12.8, 1.2));
    return units;
  }
  if (p.kind === 'tram') {
    const units = [rect(-9.8, 0)];
    for (const last of [false, true]) {
      origin = [origin[0] - f[0] * 10, origin[1] - f[1] * 10];
      rotate(p.bend);
      units.push(rect(last ? -10 : -9.8, 0));
    }
    return units;
  }
  return [rect(-length, 0)];
}

/** Top view of every vehicle for the 2D map, coloured like the dots by speed. */
export function vehicleShapes(poses: readonly VehiclePose[]): FeatureCollection<Polygon> {
  const features: Feature<Polygon>[] = [];
  for (const p of poses) {
    const kx = M_PER_DEG * Math.cos((p.lat * Math.PI) / 180);
    const color = p.kind === 'pedestrian' ? '#3F8BC4' : bandColor(p.kmh);
    for (const ring of unitOutlines(p)) {
      features.push({
        type: 'Feature',
        properties: { color },
        geometry: { type: 'Polygon', coordinates: [ring.map(([e, n]) => [p.lon + e / kx, p.lat + n / M_PER_DEG])] },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}
