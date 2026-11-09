import earcut from 'earcut';
import { isDrivable } from '../osm/tags';
import type { OsmDoc, OsmWay } from '../osm/types';
import { buildingHeight, LAYER_STEP } from '../osm/height';

/**
 * Geometry of the 3D view in local metres around an origin: x east, y south (the way Web
 * Mercator grows), z up. Kept free of WebGL so it can be tested.
 */

export type Rgb = readonly [number, number, number];
export type Scene3dColors = { building: Rgb; deck: (highway: string) => Rgb; deckSide: Rgb; pier: Rgb; portal: Rgb };

/**
 * Interleaved x, y, z, r, g, b, id, nx, ny, nz, shade, pick. `id` numbers blocks of touching
 * buildings from 1, so the road cutaway cuts each block as a whole; it is 0 for bridges and
 * portals, which are never cut. The normal and `shade` (the wall gradient) feed the same
 * lighting MapLibre gives its extruded buildings. `pick` numbers single buildings from 1 for
 * clicks and highlighting: `buildingIds[pick - 1]` is the OSM way.
 */
export const STRIDE = 12;

export type Scene3dMesh = {
  /** Mercator x, y of the origin and metres per Mercator unit there. */
  origin: { x: number; y: number; metersPerUnit: number };
  /** How many blocks are numbered in `solid`; touching sections share a number. */
  buildings: number;
  /** OSM way of every building, by its `pick` number minus one. */
  buildingIds: string[];
  /** Building triangles, wound the same way as the roofs seen from outside. */
  solid: Float32Array;
  /** Bridge decks, piers and tunnel portals: opaque, never cut away. */
  structures: Float32Array;
  /** Road ribbons as triangles with x, y, z only: what the cutaway looks for behind buildings. */
  roadMask: Float32Array;
};

export const LANE_WIDTH = 3.5;
/** Height of one OSM `layer` step for bridges. */
export const LAYER_HEIGHT = LAYER_STEP;
const DECK_THICKNESS = 1.2;
const PARAPET = 1.0;
const PIER_SPACING = 30;
const PIER_SIZE = 1.4;
const PORTAL_HEIGHT = 6;
const PORTAL_DEPTH = 1.5;
const PORTAL_PILLAR = 1.2;
const PORTAL_CLEARANCE = 4.8;

export const mercatorX = (lon: number) => (lon + 180) / 360;
export const mercatorY = (lat: number) => (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360;
const EARTH_CIRCUMFERENCE = 40075016.686;
export const metersPerMercatorUnit = (lat: number) => EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180);

const isYes = (v: string | undefined) => Boolean(v && v !== 'no');
export const isBridge = (w: OsmWay) => isYes(w.tags.bridge);
export const isTunnel = (w: OsmWay) => isYes(w.tags.tunnel);

/** Deck height of a bridge: its OSM `layer` (at least 1) times one layer step. */
export function bridgeHeight(tags: Record<string, string>): number {
  const layer = Number.parseInt(tags.layer ?? '', 10);
  return (Number.isFinite(layer) && layer > 0 ? layer : 1) * LAYER_HEIGHT;
}

export function roadWidth(tags: Record<string, string>): number {
  const width = Number.parseFloat(tags.width ?? '');
  if (Number.isFinite(width) && width > 0) return width;
  const lanes = Number.parseInt(tags.lanes ?? '', 10);
  const oneway = tags.oneway === 'yes' || tags.oneway === '1' || tags.oneway === '-1' || tags.junction === 'roundabout';
  return (Number.isFinite(lanes) && lanes > 0 ? lanes : oneway ? 1 : 2) * LANE_WIDTH;
}

type P2 = [number, number];

class Buf {
  private data: number[] = [];
  push(...v: number[]) { for (const x of v) this.data.push(x); }
  get length() { return this.data.length; }
  /** Writes `value` into field `field` of every vertex from `start` (a length) on. */
  fill(start: number, field: number, value: number) {
    for (let i = start + field; i < this.data.length; i += STRIDE) this.data[i] = value;
  }
  get array() { return new Float32Array(this.data); }
}

/**
 * Deck height along a bridge. The deck climbs from the ground at both ends over a ramp of up to
 * 30 m (a quarter of the bridge on short ones), since the roads it joins stay on the ground.
 */
export function deckProfile(lengths: readonly number[], height: number): number[] {
  const total = lengths[lengths.length - 1] ?? 0;
  const ramp = Math.min(30, total / 4);
  return lengths.map((d) => {
    if (ramp <= 0) return height;
    const k = Math.min(1, d / ramp, (total - d) / ramp);
    return height * (k * k * (3 - 2 * k));
  });
}

function cumulative(pts: readonly P2[]): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i += 1) out.push(out[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return out;
}

/** Unit normal pointing to the left of a segment. */
function leftNormal(a: P2, b: P2): P2 {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  return [-dy / l, dx / l];
}

/** Offsets of a polyline to both sides, mitred at the vertices (mitre capped at 3×). */
function offsets(pts: readonly P2[], half: number): { left: P2[]; right: P2[] } {
  const left: P2[] = [];
  const right: P2[] = [];
  pts.forEach((p, i) => {
    const n0 = i > 0 ? leftNormal(pts[i - 1], p) : null;
    const n1 = i < pts.length - 1 ? leftNormal(p, pts[i + 1]) : null;
    let n: P2 = n0 && n1 ? [n0[0] + n1[0], n0[1] + n1[1]] : (n0 ?? n1)!;
    const l = Math.hypot(n[0], n[1]) || 1;
    n = [n[0] / l, n[1] / l];
    const ref = n1 ?? n0!;
    const cos = Math.max(1 / 3, n[0] * ref[0] + n[1] * ref[1]);
    const d = half / cos;
    left.push([p[0] + n[0] * d, p[1] + n[1] * d]);
    right.push([p[0] - n[0] * d, p[1] - n[1] * d]);
  });
  return { left, right };
}

type V3 = readonly [number, number, number];

/**
 * Sign applied to the cross product of a triangle to get the normal used for lighting. Roofs take
 * the opposite sign to point up; walls keep this one, which points inwards: MapLibre lights its
 * extruded walls with that normal, and the 3D view is meant to look the same.
 */
const OUTWARD = -1;

/** Wall shade of MapLibre's vertical gradient (light intensity 0.5): darker low, 1 at 150 m. */
export function wallShade(base: number, top: boolean, height: number): number {
  const t = top ? 1 : 0;
  return Math.min(1, Math.max(0.84, (t + base) * Math.sqrt(Math.max(0, height) / 150)));
}

type Shade = (v: V3) => number;
const FLAT: Shade = () => 1;

function tri(buf: Buf, c: Rgb, cut: number, a: V3, b: V3, d: V3, shade: Shade = FLAT, sign = OUTWARD) {
  const ux = b[0] - a[0]; const uy = b[1] - a[1]; const uz = b[2] - a[2];
  const vx = d[0] - a[0]; const vy = d[1] - a[1]; const vz = d[2] - a[2];
  let nx = uy * vz - uz * vy; let ny = uz * vx - ux * vz; let nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx = (nx / l) * sign; ny = (ny / l) * sign; nz = (nz / l) * sign;
  for (const v of [a, b, d]) buf.push(v[0], v[1], v[2], c[0], c[1], c[2], cut, nx, ny, nz, shade(v), 0);
}

/** Quad a-b-c-d, wound the same way as given. */
function quad(buf: Buf, c: Rgb, cut: number, a: V3, b: V3, d: V3, e: V3, shade: Shade = FLAT, sign = OUTWARD) {
  tri(buf, c, cut, a, b, d, shade, sign);
  tri(buf, c, cut, a, d, e, shade, sign);
}

/** Axis-free box on a footprint (4 corners counter-clockwise seen from above) between z0 and z1. */
function prism(buf: Buf, c: Rgb, cut: number, ring: readonly P2[], z0: number, z1: number) {
  const n = ring.length;
  for (let i = 0; i < n; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    quad(buf, c, cut, [a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]);
  }
  const top = ring.map((p) => [p[0], p[1], z1] as V3);
  for (let i = 1; i < n - 1; i += 1) tri(buf, c, cut, top[0], top[i], top[i + 1]);
}

/** Twice the signed area in the x-east, y-south frame; positive means counter-clockwise seen from above. */
function signedArea(ring: readonly P2[]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  // y points south, so the usual formula flips sign.
  return -s;
}

const ccw = (ring: P2[]) => (signedArea(ring) < 0 ? ring.reverse() : ring);

function addBuilding(solid: Buf, id: number, ring: P2[], base: number, height: number, colors: Scene3dColors) {
  if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring = ring.slice(0, -1);
  if (ring.length < 3 || height <= base) return;
  ring = ccw(ring);
  const c = colors.building;
  const n = ring.length;
  const shade: Shade = (v) => wallShade(base, v[2] >= height, height);
  for (let i = 0; i < n; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    quad(solid, c, id, [a[0], a[1], base], [a[0], a[1], height], [b[0], b[1], height], [b[0], b[1], base], shade, OUTWARD);
  }
  const flat = ring.flatMap((p) => p);
  const idx = earcut(flat);
  for (let i = 0; i < idx.length; i += 3) {
    const t = [ring[idx[i]], ring[idx[i + 1]], ring[idx[i + 2]]];
    // Wound clockwise seen from above, like the walls seen from outside: both face the camera.
    if (signedArea(t) > 0) t.reverse();
    tri(solid, c, id, [t[0][0], t[0][1], height], [t[1][0], t[1][1], height], [t[2][0], t[2][1], height], FLAT, -OUTWARD);
  }
}

/** Adds points so that no piece is longer than `step` metres: ramps need them to bend. */
export function densify(pts: readonly P2[], step: number): P2[] {
  const out: P2[] = [pts[0]];
  for (let i = 1; i < pts.length; i += 1) {
    const [a, b] = [pts[i - 1], pts[i]];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 1; k <= n; k += 1) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

const RAMP_STEP = 3;

function addBridge(solid: Buf, mask: Buf, raw: P2[], tags: Record<string, string>, colors: Scene3dColors) {
  const pts = densify(raw, RAMP_STEP);
  const half = roadWidth(tags) / 2;
  const z = deckProfile(cumulative(pts), bridgeHeight(tags));
  const { left, right } = offsets(pts, half);
  const outer = offsets(pts, half + 0.3);
  for (let i = 0; i < pts.length - 1; i += 1) {
    const [l0, l1, r0, r1] = [left[i], left[i + 1], right[i], right[i + 1]];
    const [z0, z1] = [z[i], z[i + 1]];
    // Deck top, seen from above: right edge to left edge is counter-clockwise.
    quad(solid, colors.deck((tags.highway ?? '').replace(/_link$/, '')), 0, [r0[0], r0[1], z0], [r1[0], r1[1], z1], [l1[0], l1[1], z1], [l0[0], l0[1], z0]);
    // Underside and the two sides.
    const b0 = z0 - DECK_THICKNESS;
    const b1 = z1 - DECK_THICKNESS;
    quad(solid, colors.deckSide, 0, [l0[0], l0[1], b0], [l1[0], l1[1], b1], [r1[0], r1[1], b1], [r0[0], r0[1], b0]);
    quad(solid, colors.deckSide, 0, [r0[0], r0[1], b0], [r1[0], r1[1], b1], [r1[0], r1[1], z1 + PARAPET], [r0[0], r0[1], z0 + PARAPET]);
    quad(solid, colors.deckSide, 0, [l1[0], l1[1], b1], [l0[0], l0[1], b0], [l0[0], l0[1], z0 + PARAPET], [l1[0], l1[1], z1 + PARAPET]);
    // Parapet inner faces and tops.
    const [ol0, ol1, or0, or1] = [outer.left[i], outer.left[i + 1], outer.right[i], outer.right[i + 1]];
    quad(solid, colors.deckSide, 0, [r1[0], r1[1], z1], [r0[0], r0[1], z0], [r0[0], r0[1], z0 + PARAPET], [r1[0], r1[1], z1 + PARAPET]);
    quad(solid, colors.deckSide, 0, [l0[0], l0[1], z0], [l1[0], l1[1], z1], [l1[0], l1[1], z1 + PARAPET], [l0[0], l0[1], z0 + PARAPET]);
    quad(solid, colors.deckSide, 0, [or0[0], or0[1], z0 + PARAPET], [r0[0], r0[1], z0 + PARAPET], [r1[0], r1[1], z1 + PARAPET], [or1[0], or1[1], z1 + PARAPET]);
    quad(solid, colors.deckSide, 0, [l0[0], l0[1], z0 + PARAPET], [ol0[0], ol0[1], z0 + PARAPET], [ol1[0], ol1[1], z1 + PARAPET], [l1[0], l1[1], z1 + PARAPET]);
    ribbon(mask, l0, l1, r0, r1, z0 + 0.05, z1 + 0.05);
  }
  addPiers(solid, pts, z, colors);
}

/** Piers every 30 m where the deck is high enough to stand on one. */
function addPiers(solid: Buf, pts: P2[], z: number[], colors: Scene3dColors) {
  const dist = cumulative(pts);
  const total = dist[dist.length - 1];
  const count = Math.floor(total / PIER_SPACING);
  for (let k = 1; k <= count; k += 1) {
    const d = (k * total) / (count + 1);
    const i = Math.max(0, dist.findIndex((x) => x >= d) - 1);
    const t = (d - dist[i]) / ((dist[i + 1] - dist[i]) || 1);
    const p: P2 = [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
    const top = z[i] + (z[i + 1] - z[i]) * t - DECK_THICKNESS;
    if (top < 2) continue;
    const s = PIER_SIZE / 2;
    prism(solid, colors.pier, 0, [[p[0] - s, p[1] + s], [p[0] + s, p[1] + s], [p[0] + s, p[1] - s], [p[0] - s, p[1] - s]], 0, top);
  }
}

function ribbon(mask: Buf, l0: P2, l1: P2, r0: P2, r1: P2, z0: number, z1: number) {
  mask.push(l0[0], l0[1], z0, r0[0], r0[1], z0, r1[0], r1[1], z1);
  mask.push(l0[0], l0[1], z0, r1[0], r1[1], z1, l1[0], l1[1], z1);
}

/** A portal frame across the road where a tunnel meets the open air: two pillars and a lintel. */
function addPortal(solid: Buf, at: P2, toward: P2, half: number, colors: Scene3dColors) {
  const dx = toward[0] - at[0];
  const dy = toward[1] - at[1];
  const l = Math.hypot(dx, dy) || 1;
  const f: P2 = [dx / l, dy / l];
  const n: P2 = [-f[1], f[0]];
  const w = half + PORTAL_PILLAR;
  const box = (a: number, b: number): P2[] => {
    const c = (s: number, t: number): P2 => [at[0] + n[0] * s + f[0] * t, at[1] + n[1] * s + f[1] * t];
    return ccw([c(a, 0), c(b, 0), c(b, PORTAL_DEPTH), c(a, PORTAL_DEPTH)]);
  };
  prism(solid, colors.portal, 0, box(-w, -half), 0, PORTAL_HEIGHT);
  prism(solid, colors.portal, 0, box(half, w), 0, PORTAL_HEIGHT);
  // Lintel: a box over the opening between clearance and the full height.
  const lintel = box(-half, half);
  prism(solid, colors.portal, 0, lintel, PORTAL_CLEARANCE, PORTAL_HEIGHT);
}

/** Gap up to which two building outlines count as one wall. */
const TOUCH = 0.5;
const CELL = 8;

/**
 * Groups buildings that touch: a shared node, or a corner of one on a wall of another within
 * half a metre. Sections of one block are separate ways in OSM, and the cutaway must cut them
 * along one line. Returns a group number from 1 for every building, in the order given.
 */
export function buildingGroups(rings: ReadonlyArray<{ refs: readonly string[]; pts: readonly P2[] }>): number[] {
  const parent = rings.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const join = (a: number, b: number) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent[ra] = rb; };

  const byNode = new Map<string, number>();
  rings.forEach((r, i) => r.refs.forEach((ref) => {
    const other = byNode.get(ref);
    if (other === undefined) byNode.set(ref, i); else join(i, other);
  }));

  const grid = new Map<string, Array<[number, P2, P2]>>();
  const key = (x: number, y: number) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
  rings.forEach((r, i) => {
    for (let k = 0; k + 1 < r.pts.length; k += 1) {
      const a = r.pts[k];
      const b = r.pts[k + 1];
      const [x0, x1] = [Math.min(a[0], b[0]) - TOUCH, Math.max(a[0], b[0]) + TOUCH];
      const [y0, y1] = [Math.min(a[1], b[1]) - TOUCH, Math.max(a[1], b[1]) + TOUCH];
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx += 1) {
        for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy += 1) {
          const c = `${cx},${cy}`;
          const list = grid.get(c);
          if (list) list.push([i, a, b]); else grid.set(c, [[i, a, b]]);
        }
      }
    }
  });
  const near = (p: P2, a: P2, b: P2) => {
    const dx = b[0] - a[0]; const dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy) <= TOUCH;
  };
  rings.forEach((r, i) => r.pts.forEach((p) => {
    for (const [j, a, b] of grid.get(key(p[0], p[1])) ?? []) if (j !== i && find(j) !== find(i) && near(p, a, b)) join(i, j);
  }));

  const numbers = new Map<number, number>();
  return rings.map((_, i) => {
    const root = find(i);
    if (!numbers.has(root)) numbers.set(root, numbers.size + 1);
    return numbers.get(root)!;
  });
}

export function buildScene3d(doc: OsmDoc, colors: Scene3dColors): Scene3dMesh | null {
  const nodes = Object.values(doc.nodes);
  if (!nodes.length) return null;
  let minLon = Infinity; let maxLon = -Infinity; let minLat = Infinity; let maxLat = -Infinity;
  for (const n of nodes) {
    if (n.lon < minLon) minLon = n.lon;
    if (n.lon > maxLon) maxLon = n.lon;
    if (n.lat < minLat) minLat = n.lat;
    if (n.lat > maxLat) maxLat = n.lat;
  }
  const lat0 = (minLat + maxLat) / 2;
  const origin = { x: mercatorX((minLon + maxLon) / 2), y: mercatorY(lat0), metersPerUnit: metersPerMercatorUnit(lat0) };
  const local = (id: string): P2 | null => {
    const n = doc.nodes[id];
    return n ? [(mercatorX(n.lon) - origin.x) * origin.metersPerUnit, (mercatorY(n.lat) - origin.y) * origin.metersPerUnit] : null;
  };
  const pointsOf = (w: OsmWay) => w.refs.map(local).filter((p): p is P2 => p !== null);

  const solid = new Buf();
  const structures = new Buf();
  const mask = new Buf();

  // How many drivable non-tunnel ways touch each node: a tunnel end there is a portal.
  const openAir = new Map<string, number>();
  Object.values(doc.ways).forEach((w) => {
    if (!isDrivable(w.tags) || isTunnel(w)) return;
    w.refs.forEach((r) => openAir.set(r, (openAir.get(r) ?? 0) + 1));
  });

  const buildingWays = Object.values(doc.ways).filter((w) => w.tags.building && w.refs.length >= 4);
  const rings = buildingWays.map((w) => ({ refs: w.refs, pts: pointsOf(w) }));
  const groups = buildingGroups(rings);
  rings.forEach((r, i) => {
    const w = buildingWays[i];
    const { height, minHeight } = buildingHeight(w.tags);
    const start = solid.length;
    addBuilding(solid, groups[i], [...r.pts], minHeight, height, colors);
    solid.fill(start, 11, i + 1);
  });
  const buildings = groups.reduce((a, b) => Math.max(a, b), 0);

  Object.values(doc.ways).forEach((w) => {
    const pts = pointsOf(w);
    if (pts.length < 2 || w.tags.building) return;
    if (!isDrivable(w.tags)) return;
    if (isBridge(w)) { addBridge(structures, mask, pts, w.tags, colors); return; }
    if (isTunnel(w)) {
      const half = roadWidth(w.tags) / 2;
      if (openAir.has(w.refs[0])) addPortal(structures, pts[0], pts[1], half, colors);
      const last = w.refs.length - 1;
      if (openAir.has(w.refs[last])) addPortal(structures, pts[pts.length - 1], pts[pts.length - 2], half, colors);
      return;
    }
    // Yard driveways and parking aisles are drawn thin, like paths, and do not cut buildings.
    if (w.tags.highway === 'service') return;
    const { left, right } = offsets(pts, roadWidth(w.tags) / 2);
    for (let i = 0; i < pts.length - 1; i += 1) ribbon(mask, left[i], left[i + 1], right[i], right[i + 1], 0, 0);
  });

  return { origin, buildings, buildingIds: buildingWays.map((w) => w.id), solid: solid.array, structures: structures.array, roadMask: mask.array };
}
