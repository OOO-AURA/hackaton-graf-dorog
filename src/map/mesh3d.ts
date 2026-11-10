import earcut from 'earcut';
import { isDrivable } from '../osm/tags';
import { pieceAround, type Piece } from '../osm/pieces';
import type { OsmDoc, OsmWay } from '../osm/types';
import { buildingHeight, LAYER_STEP } from '../osm/height';
import { sectionAt, sectionOf, widthOf, type CrossSection, type Taper } from './section';
import { drawnRoads, roadShifts } from './shift';
import { offsetLine } from './polyline';
import { isLifted, nodeElevations } from './elevation';
import { signPoints } from '../osm/signs';
import { addStreetProps } from './props3d';

/**
 * Geometry of the 3D view in local metres around an origin: x east, y south (the way Web
 * Mercator grows), z up. Kept free of WebGL so it can be tested.
 */

export type Rgb = readonly [number, number, number];
export type Scene3dColors = { building: Rgb; deck: (highway: string) => Rgb; deckSide: Rgb; parapet: Rgb; embankment: Rgb; mark: Rgb; markCasing: Rgb; pier: Rgb; portal: Rgb };

/**
 * Interleaved x, y, z, r, g, b, id, nx, ny, nz, shade, pick. `id` numbers blocks of touching
 * buildings from 1, so the road cutaway cuts each block as a whole; it is 0 for bridges and
 * portals, which are never cut. The normal and `shade` (the wall gradient) feed the same
 * lighting MapLibre gives its extruded buildings. `pick` numbers single buildings from 1 for
 * clicks and highlighting, buildings first and then bridges: `pickIds[pick - 1]` is the OSM way.
 */
export const STRIDE = 12;

export type Scene3dMesh = {
  /** Mercator x, y of the origin and metres per Mercator unit there. */
  origin: { x: number; y: number; metersPerUnit: number };
  /** How many blocks are numbered in `solid`; touching sections share a number. */
  buildings: number;
  /** OSM way of every building and bridge, by its `pick` number minus one. */
  pickIds: string[];
  /**
   * The stretch between junctions each pick number covers, for bridges cut by junctions into
   * several (a stretch is picked and lit alone); null where the number covers the whole way.
   */
  pickPieces: Array<Piece | null>;
  /** Building triangles, wound the same way as the roofs seen from outside. */
  solid: Float32Array;
  /** Bridge decks, piers and tunnel portals: opaque, never cut away. */
  structures: Float32Array;
  /** Tunnels as see-through tubes under the ground. */
  underground: Float32Array;
  /** Shadows of bridge decks on the ground, drawn see-through so the roads under them show. */
  shadows: Float32Array;
  /** Road ribbons as triangles with x, y, z only: what the cutaway looks for behind buildings. */
  roadMask: Float32Array;
};

export const LANE_WIDTH = 3.5;
/** Height of one OSM `layer` step for bridges. */
export const LAYER_HEIGHT = LAYER_STEP;
const DECK_THICKNESS = 1.2;
const PARAPET = 1.0;
/** Parapets are wide enough to show as a light outline of the deck from a normal 3D view. */
const PARAPET_WIDTH = 0.7;
const PIER_SPACING = 15;
const PIER_SIZE = 1.8;
/**
 * Where a deck's shadow falls, in metres east and south per metre of deck height: the sun stands
 * in the north-west of the screen, as in MapLibre's default light, so the shadow goes south-east.
 */
const SHADOW_REACH: P2 = [0.9, 1.2];
/** Just above the ground, so the shadow is not lost in the road lines. */
const SHADOW_Z = 0.08;
const SHADOW: Rgb = [0, 0, 0];
/** Lane markings on a deck: a light line on a wider dark outline, like the markings in 2D. */
const MARK_WIDTH = 0.3;
const MARK_CASING = 0.55;
/**
 * Height of the markings over the road surface. Where two raised roads part at a fork their
 * surfaces overlap at almost the same height (each falls about 4 cm per metre down its approach),
 * so the markings stand clear of that, or one road would hide the other's lanes.
 */
const MARK_LIFT = 0.12;
const PORTAL_DEPTH = 1.5;
const PORTAL_PILLAR = 1.2;

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

/** Carriageway width, the same as the 2D road and its lanes. */
export function roadWidth(tags: Record<string, string>): number {
  return widthOf(sectionOf(tags));
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
  /** Field `field` of the vertex that starts at `at`. */
  at(at: number, field: number) { return this.data[at + field]; }
  set(at: number, field: number, value: number) { this.data[at + field] = value; }
}

/** The index of the segment of `pts` nearest to (x, y). */
function nearestSegment(pts: readonly P2[], x: number, y: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const dx = pts[i + 1][0] - ax, dy = pts[i + 1][1] - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    const d = (x - ax - dx * t) ** 2 + (y - ay - dy * t) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/**
 * Deck height along a bridge. An end that joins other roads stays at deck height: they climb to
 * it on an embankment (see elevation.ts). An end that joins nothing comes down to the ground over a
 * ramp of up to 30 m (a quarter of the bridge on short ones).
 */
export function deckProfile(lengths: readonly number[], height: number, rampStart = true, rampEnd = true): number[] {
  const total = lengths[lengths.length - 1] ?? 0;
  const ramp = Math.min(30, total / 4);
  return lengths.map((d) => {
    if (ramp <= 0) return height;
    const k = Math.min(1, rampStart ? d / ramp : 1, rampEnd ? (total - d) / ramp : 1);
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

/**
 * Offsets of a polyline to both sides, mitred at the vertices (mitre capped at 3×): `left` by `a`
 * along leftNormal (with y south, the right of travel), `right` by `b` the other way. Either is a
 * distance for the whole line or one per point.
 */
function offsets(pts: readonly P2[], a: number | readonly number[], b: number | readonly number[] = a): { left: P2[]; right: P2[] } {
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
    const da = (typeof a === 'number' ? a : a[i]) / cos;
    const db = (typeof b === 'number' ? b : b[i]) / cos;
    left.push([p[0] + n[0] * da, p[1] + n[1] * da]);
    right.push([p[0] - n[0] * db, p[1] - n[1] * db]);
  });
  return { left, right };
}

/** Cross-sections at every point of a way's polyline, tapers included. */
function sectionsAlong(pts: readonly P2[], tags: Record<string, string>, tapers: readonly Taper[] | undefined): { dist: number[]; sections: CrossSection[] } {
  const dist = cumulative(pts);
  const total = dist[dist.length - 1];
  const base = sectionOf(tags);
  return { dist, sections: dist.map((d) => sectionAt(base, tapers, d, total)) };
}

/** Carriageway edges along a way: `left` here is the right of travel (y points south). */
function carriageway(pts: readonly P2[], sections: readonly CrossSection[], extra = 0) {
  return offsets(pts, sections.map((c) => c.right + extra), sections.map((c) => c.left + extra));
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
/** Point spacing on a deck that narrows, so its edges and merging markings bend smoothly. */
const TAPER_STEP = 1.5;
/** Length of the dashes of lane markings on a deck. */
const DASH = 3;

/**
 * Underside of the deck at deck height `z`. On the ramps the slab would reach below the ground,
 * and the 3D view has no ground to hide it, so it stops just under the ground: where the deck
 * meets the road it is a thin sheet level with it.
 */
export const deckBottom = (z: number) => Math.max(z - DECK_THICKNESS, Math.min(z, 0) - 0.02);
/** Parapets grow with the deck from nothing where it meets the road to full height 2 m up. */
export const parapetAt = (z: number) => PARAPET * Math.max(0, Math.min(1, z / 2));

function addBridge(solid: Buf, shadows: Buf, mask: Buf, raw: P2[], tags: Record<string, string>, tapers: readonly Taper[] | undefined, colors: Scene3dColors, rampStart = true, rampEnd = true) {
  const pts = densify(raw, tapers ? TAPER_STEP : RAMP_STEP);
  const { dist, sections } = sectionsAlong(pts, tags, tapers);
  const z = deckProfile(dist, bridgeHeight(tags), rampStart, rampEnd);
  const { left, right } = carriageway(pts, sections);
  const outer = carriageway(pts, sections, PARAPET_WIDTH);
  for (let i = 0; i < pts.length - 1; i += 1) {
    const [l0, l1, r0, r1] = [left[i], left[i + 1], right[i], right[i + 1]];
    const [z0, z1] = [z[i], z[i + 1]];
    const [p0, p1] = [parapetAt(z0), parapetAt(z1)];
    // Deck top, seen from above: right edge to left edge is counter-clockwise.
    quad(solid, colors.deck((tags.highway ?? '').replace(/_link$/, '')), 0, [r0[0], r0[1], z0], [r1[0], r1[1], z1], [l1[0], l1[1], z1], [l0[0], l0[1], z0]);
    // Underside and the two sides.
    const b0 = deckBottom(z0);
    const b1 = deckBottom(z1);
    quad(solid, colors.deckSide, 0, [l0[0], l0[1], b0], [l1[0], l1[1], b1], [r1[0], r1[1], b1], [r0[0], r0[1], b0]);
    quad(solid, colors.deckSide, 0, [r0[0], r0[1], b0], [r1[0], r1[1], b1], [r1[0], r1[1], z1 + p1], [r0[0], r0[1], z0 + p0]);
    quad(solid, colors.deckSide, 0, [l1[0], l1[1], b1], [l0[0], l0[1], b0], [l0[0], l0[1], z0 + p0], [l1[0], l1[1], z1 + p1]);
    // Parapet inner faces and tops.
    const [ol0, ol1, or0, or1] = [outer.left[i], outer.left[i + 1], outer.right[i], outer.right[i + 1]];
    quad(solid, colors.deckSide, 0, [r1[0], r1[1], z1], [r0[0], r0[1], z0], [r0[0], r0[1], z0 + p0], [r1[0], r1[1], z1 + p1]);
    quad(solid, colors.deckSide, 0, [l0[0], l0[1], z0], [l1[0], l1[1], z1], [l1[0], l1[1], z1 + p1], [l0[0], l0[1], z0 + p0]);
    // Light parapet tops outline the deck, so it reads as a bridge from above too; not where the
    // deck lies on the ground, where they would be white stripes along the road.
    if (p0 > 0.05 && p1 > 0.05) quad(solid, colors.parapet, 0, [or0[0], or0[1], z0 + p0], [r0[0], r0[1], z0 + p0], [r1[0], r1[1], z1 + p1], [or1[0], or1[1], z1 + p1]);
    if (p0 > 0.05 && p1 > 0.05) quad(solid, colors.parapet, 0, [l0[0], l0[1], z0 + p0], [ol0[0], ol0[1], z0 + p0], [ol1[0], ol1[1], z1 + p1], [l1[0], l1[1], z1 + p1]);
    ribbon(mask, l0, l1, r0, r1, z0 + 0.05, z1 + 0.05);
    addShadow(shadows, [ol0, ol1, or0, or1], z0, z1);
  }
  addMarkings(solid, pts, z, dist, sections, colors);
  addPiers(solid, pts, z, colors);
}

/** A flat band `width` wide around `centre[i]` (metres along leftNormal), `lift` above the deck; `keep` drops pieces. */
function band(buf: Buf, c: Rgb, pts: readonly P2[], z: readonly number[], centre: readonly number[], width: number, lift: number, keep: (i: number) => boolean) {
  const { left: a } = offsets(pts, centre.map((x) => x - width / 2));
  const { left: b } = offsets(pts, centre.map((x) => x + width / 2));
  for (let i = 0; i < pts.length - 1; i += 1) {
    if (!keep(i)) continue;
    quad(buf, c, 0, [a[i][0], a[i][1], z[i] + lift], [a[i + 1][0], a[i + 1][1], z[i + 1] + lift], [b[i + 1][0], b[i + 1][1], z[i + 1] + lift], [b[i][0], b[i][1], z[i] + lift]);
  }
}

/**
 * Lane markings on the deck, where the 2D ones would lie hidden under it: the same markings as
 * in 2D, ending where lanes merge on a deck that narrows.
 */
function addMarkings(solid: Buf, pts: readonly P2[], z: readonly number[], dist: readonly number[], sections: readonly CrossSection[], colors: Scene3dColors) {
  const keys = new Set(sections.flatMap((s) => s.dividers.map((m) => m.key)));
  for (const key of keys) {
    const at = sections.map((s) => s.dividers.find((m) => m.key === key));
    // lanesGeo counts offsets to the left of travel with y north; here y points south.
    const centre = at.map((m) => -(m?.offset ?? 0));
    const solidLine = at.some((m) => m?.solid);
    const present = (i: number) => Boolean(at[i] && at[i + 1]);
    band(solid, colors.markCasing, pts, z, centre, MARK_CASING, MARK_LIFT, present);
    band(solid, colors.mark, pts, z, centre, MARK_WIDTH, MARK_LIFT * 2, (i) => present(i) && (solidLine || Math.floor((dist[i] + dist[i + 1]) / 2 / DASH) % 2 === 0));
  }
}

/** The deck footprint between two cross-sections, shifted away from the sun by the deck height there. */
function addShadow(shadows: Buf, [l0, l1, r0, r1]: readonly P2[], z0: number, z1: number) {
  if (z0 <= 0 && z1 <= 0) return;
  const at = (p: P2, z: number): V3 => [p[0] + SHADOW_REACH[0] * z, p[1] + SHADOW_REACH[1] * z, SHADOW_Z];
  quad(shadows, SHADOW, 0, at(r0, z0), at(r1, z1), at(l1, z1), at(l0, z0));
}

/** Below this the road lies on the ground and the 2D line shows it. */
const ON_GROUND = 0.05;

/** A polyline with its heights, with points added so no piece is longer than `step`. */
function densifyWithHeight(pts: readonly P2[], zs: readonly number[], step: number): { pts: P2[]; z: number[] } {
  const out: P2[] = [pts[0]];
  const z: number[] = [zs[0]];
  for (let i = 1; i < pts.length; i += 1) {
    const [a, b] = [pts[i - 1], pts[i]];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 1; k <= n; k += 1) {
      out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
      z.push(zs[i - 1] + ((zs[i] - zs[i - 1]) * k) / n);
    }
  }
  return { pts: out, z };
}

/**
 * A road on an embankment up to a bridge: the carriageway at its height with lane markings, without
 * earth slopes at the sides.
 */
function addEmbankment(solid: Buf, mask: Buf, raw: P2[], rawZ: number[], tags: Record<string, string>, tapers: readonly Taper[] | undefined, colors: Scene3dColors) {
  const { pts, z } = densifyWithHeight(raw, rawZ, tapers ? TAPER_STEP : RAMP_STEP);
  const { dist, sections } = sectionsAlong(pts, tags, tapers);
  const { left, right } = carriageway(pts, sections);
  const road = colors.deck((tags.highway ?? '').replace(/_link$/, ''));
  for (let i = 0; i < pts.length - 1; i += 1) {
    const [z0, z1] = [z[i], z[i + 1]];
    if (z0 < ON_GROUND && z1 < ON_GROUND) continue;
    const [l0, l1, r0, r1] = [left[i], left[i + 1], right[i], right[i + 1]];
    quad(solid, road, 0, [r0[0], r0[1], z0], [r1[0], r1[1], z1], [l1[0], l1[1], z1], [l0[0], l0[1], z0]);
    ribbon(mask, l0, l1, r0, r1, z0 + 0.05, z1 + 0.05);
  }
  addMarkings(solid, pts, z, dist, sections, colors);
}

/** Depth of a tunnel's road below the ground: its OSM `layer` (at least −1) times one step. */
export function tunnelDepth(tags: Record<string, string>): number {
  const layer = Number.parseInt(tags.layer ?? '', 10);
  return (Number.isFinite(layer) && layer < 0 ? -layer : 1) * LAYER_HEIGHT;
}

const TUNNEL_HEIGHT = 5;
/** Room between the road edge and the tunnel wall. */
const TUNNEL_SIDE = 0.5;
/** Height of the straight walls; above them the roof is a half-ellipse up to TUNNEL_HEIGHT. */
const TUNNEL_WALL = 2;
const ARCH_SEGMENTS = 10;

/**
 * Cross-section of a tunnel from the right foot over the arch to the left foot, as
 * (across, up): `across` runs from 0 at the right edge to 1 at the left one.
 */
export const TUNNEL_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  ...Array.from({ length: ARCH_SEGMENTS + 1 }, (_, k) => {
    const a = (Math.PI * k) / ARCH_SEGMENTS;
    return [(1 - Math.cos(a)) / 2, TUNNEL_WALL + (TUNNEL_HEIGHT - TUNNEL_WALL) * Math.sin(a)] as const;
  }),
  [1, 0],
];

/**
 * A tunnel as an arched tube under the ground: the road at its depth, walls and a rounded roof.
 * It dives from the ground at both ends like a bridge rises, so at the portals the arch stands
 * above the ground, inside the portal frame.
 */
function addTunnel(buf: Buf, raw: P2[], tags: Record<string, string>, colors: Scene3dColors) {
  const pts = densify(raw, RAMP_STEP);
  const half = roadWidth(tags) / 2 + TUNNEL_SIDE;
  const z = deckProfile(cumulative(pts), tunnelDepth(tags)).map((d) => -d);
  const { left, right } = offsets(pts, half);
  const road = colors.deck((tags.highway ?? '').replace(/_link$/, ''));
  const at = (i: number, across: number, up: number): V3 => {
    const [r, l] = [right[i], left[i]];
    return [r[0] + (l[0] - r[0]) * across, r[1] + (l[1] - r[1]) * across, z[i] + up];
  };
  for (let i = 0; i < pts.length - 1; i += 1) {
    quad(buf, road, 0, at(i, 0, 0), at(i + 1, 0, 0), at(i + 1, 1, 0), at(i, 1, 0));
    for (let k = 0; k + 1 < TUNNEL_PROFILE.length; k += 1) {
      const [a0, u0] = TUNNEL_PROFILE[k];
      const [a1, u1] = TUNNEL_PROFILE[k + 1];
      quad(buf, colors.deckSide, 0, at(i, a0, u0), at(i + 1, a0, u0), at(i + 1, a1, u1), at(i, a1, u1));
    }
  }
}

/** Piers every 15 m where the deck is high enough to stand on one. */
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
/**
 * A portal where a tunnel meets the open air: an arched frame around the tube's opening, the
 * same arch as the tube, `PORTAL_PILLAR` thick at the sides and over the top.
 */
function addPortal(solid: Buf, at: P2, toward: P2, roadHalf: number, colors: Scene3dColors) {
  const dx = toward[0] - at[0];
  const dy = toward[1] - at[1];
  const l = Math.hypot(dx, dy) || 1;
  const f: P2 = [dx / l, dy / l];
  const n: P2 = [-f[1], f[0]];
  const half = roadHalf + TUNNEL_SIDE;
  const outerHalf = half + PORTAL_PILLAR;
  const rise = TUNNEL_HEIGHT - TUNNEL_WALL;
  // Inner and outer edge of the frame for every point of the arch, at depth 0 and PORTAL_DEPTH.
  const edge = (across: number, up: number, outer: boolean, depth: number): V3 => {
    const s = (across - 0.5) * 2 * (outer ? outerHalf : half);
    const u = outer && up > TUNNEL_WALL ? TUNNEL_WALL + ((up - TUNNEL_WALL) / rise) * (rise + PORTAL_PILLAR) : up;
    return [at[0] + n[0] * s + f[0] * depth, at[1] + n[1] * s + f[1] * depth, u];
  };
  const c = colors.portal;
  for (let k = 0; k + 1 < TUNNEL_PROFILE.length; k += 1) {
    const [a0, u0] = TUNNEL_PROFILE[k];
    const [a1, u1] = TUNNEL_PROFILE[k + 1];
    // Skip the bottom: the foot-to-foot step of the profile is the road, not part of the frame.
    if (u0 === 0 && u1 === 0) continue;
    for (const d of [0, PORTAL_DEPTH]) quad(solid, c, 0, edge(a0, u0, false, d), edge(a1, u1, false, d), edge(a1, u1, true, d), edge(a0, u0, true, d));
    quad(solid, c, 0, edge(a0, u0, false, 0), edge(a1, u1, false, 0), edge(a1, u1, false, PORTAL_DEPTH), edge(a0, u0, false, PORTAL_DEPTH));
    quad(solid, c, 0, edge(a0, u0, true, 0), edge(a1, u1, true, 0), edge(a1, u1, true, PORTAL_DEPTH), edge(a0, u0, true, PORTAL_DEPTH));
  }
  // The feet of the frame: from the inner to the outer edge on the ground.
  for (const across of [0, 1]) {
    quad(solid, c, 0, edge(across, 0, false, 0), edge(across, 0, true, 0), edge(across, 0, true, PORTAL_DEPTH), edge(across, 0, false, PORTAL_DEPTH));
  }
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
  const underground = new Buf();
  const shadows = new Buf();
  const mask = new Buf();
  const { tapers } = drawnRoads(doc);

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
  const pickIds = buildingWays.map((w) => w.id);
  const pickPieces: Array<Piece | null> = buildingWays.map(() => null);

  const lifted = nodeElevations(doc);
  // A bridge end that only the bridge itself touches comes down on a ramp; others meet an embankment.
  const joined = (id: string | undefined) => (id ? (openAir.get(id) ?? 0) > 1 : false);
  Object.values(doc.ways).forEach((w) => {
    const raw = pointsOf(w);
    if (raw.length < 2 || w.tags.building) return;
    // Alongside a greater road, not on top of it (shift.ts); y points south here, so left is negative.
    const shift = roadShifts(doc).get(w.id);
    const pts = shift && shift.length === raw.length ? offsetLine(raw, shift.map((o) => -o)) : raw;
    if (!isDrivable(w.tags)) return;
    if (isBridge(w)) {
      const start = structures.length;
      addBridge(structures, shadows, mask, pts, w.tags, tapers.get(w.id), colors, !joined(w.refs[0]), !joined(w.refs[w.refs.length - 1]));
      // A bridge that junctions cut into stretches gets a pick number per stretch, so the stretch
      // under the cursor is what lights up; each vertex goes to the stretch of its nearest segment.
      const pieces = pts.length === w.refs.length ? pts.slice(0, -1).map((_, i) => pieceAround(doc, w.id, i)) : [];
      if (!pieces.some(Boolean)) {
        pickIds.push(w.id);
        pickPieces.push(null);
        structures.fill(start, 11, pickIds.length);
        return;
      }
      const numberOf = new Map<string, number>();
      const pickOfSegment = pieces.map((piece) => {
        const key = `${piece!.from}-${piece!.to}`;
        if (!numberOf.has(key)) { pickIds.push(w.id); pickPieces.push(piece); numberOf.set(key, pickIds.length); }
        return numberOf.get(key)!;
      });
      for (let v = start; v < structures.length; v += STRIDE) {
        structures.set(v, 11, pickOfSegment[nearestSegment(pts, structures.at(v, 0), structures.at(v, 1))]);
      }
      return;
    }
    if (isTunnel(w)) {
      const half = roadWidth(w.tags) / 2;
      const start = structures.length;
      if (openAir.has(w.refs[0])) addPortal(structures, pts[0], pts[1], half, colors);
      const last = w.refs.length - 1;
      if (openAir.has(w.refs[last])) addPortal(structures, pts[pts.length - 1], pts[pts.length - 2], half, colors);
      const tubeStart = underground.length;
      addTunnel(underground, pts, w.tags, colors);
      pickIds.push(w.id);
      pickPieces.push(null);
      structures.fill(start, 11, pickIds.length);
      underground.fill(tubeStart, 11, pickIds.length);
      return;
    }
    if (isLifted(doc, w)) {
      const zs = w.refs.filter((r) => doc.nodes[r] && local(r) !== null).map((r) => lifted.get(r) ?? 0);
      addEmbankment(structures, mask, pts, zs, w.tags, tapers.get(w.id), colors);
      return;
    }
    // Yard driveways and parking aisles are drawn thin, like paths, and do not cut buildings.
    if (w.tags.highway === 'service') return;
    const wayTapers = tapers.get(w.id);
    const line = wayTapers ? densify(pts, TAPER_STEP) : pts;
    const { left, right } = carriageway(line, sectionsAlong(line, w.tags, wayTapers).sections);
    for (let i = 0; i < line.length - 1; i += 1) ribbon(mask, left[i], left[i + 1], right[i], right[i + 1], 0, 0);
  });

  const at = (lon: number, lat: number): P2 => [(mercatorX(lon) - origin.x) * origin.metersPerUnit, (mercatorY(lat) - origin.y) * origin.metersPerUnit];
  const signs = signPoints(doc).features.map((f) => {
    const [lon, lat] = f.geometry.coordinates;
    const [e, n] = f.properties.travel;
    return { sign: f.properties.sign, at: at(lon, lat), travel: [e, -n] as P2 };
  });
  addStreetProps(structures, { doc, local, roadWidth, signs });

  return { origin, buildings, pickIds, pickPieces, solid: solid.array, structures: structures.array, underground: underground.array, shadows: shadows.array, roadMask: mask.array };
}
