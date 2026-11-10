import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping';
import { addNode, deleteNode, deleteWay, createWay } from './edit';
import { isBuilding } from './building';
import type { OsmDoc, OsmWay } from './types';

/**
 * Room for a new road among buildings, as a city builder game does it: the road takes a corridor
 * as wide as its carriageway plus a margin on each side; a building in the corridor is either cut
 * along it (the part under the road goes, the rest keeps its tags, and a building cut in two
 * becomes two) or demolished. Geometry is worked out in metres around the road.
 */

/** Room between the carriageway and a wall, metres on each side. */
export const CLEARANCE_MARGIN = 1;
/** A piece of building smaller than this after a cut is not kept, m². */
const MIN_PART_AREA = 20;
/** Overlap below this is a touch, not a conflict, m². */
const MIN_OVERLAP = 0.5;
/** Points on a rounded corner of the corridor. */
const JOIN_STEPS = 8;

interface LonLatPoint { readonly lon: number; readonly lat: number }
type P = [number, number];

const EARTH = (Math.PI / 180) * 6_378_137;
function frame(lat0: number) {
  const k = Math.cos((lat0 * Math.PI) / 180);
  return {
    to: (lon: number, lat: number): P => [lon * EARTH * k, lat * EARTH],
    back: ([x, y]: P): P => [x / (EARTH * k), y / EARTH],
  };
}

const area = (mp: MultiPolygon) => mp.reduce((sum, poly) => sum + poly.reduce((s, ring, i) => {
  const a = Math.abs(ring.slice(1).reduce((acc, p, j) => acc + ring[j][0] * p[1] - p[0] * ring[j][1], 0)) / 2;
  return i === 0 ? s + a : s - a;
}, 0), 0);

/** The road's corridor: a rectangle along every segment and a disc at every point, joined. */
function corridor(pts: readonly P[], half: number): MultiPolygon {
  const pieces: Polygon[] = [];
  pts.forEach((p) => {
    pieces.push([Array.from({ length: JOIN_STEPS + 1 }, (_, i) => {
      const t = (i % JOIN_STEPS) * ((2 * Math.PI) / JOIN_STEPS);
      return [p[0] + half * Math.cos(t), p[1] + half * Math.sin(t)] as P;
    })]);
  });
  pts.slice(1).forEach((b, i) => {
    const a = pts[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const n: P = [(-(b[1] - a[1]) / len) * half, ((b[0] - a[0]) / len) * half];
    pieces.push([[[a[0] + n[0], a[1] + n[1]], [b[0] + n[0], b[1] + n[1]], [b[0] - n[0], b[1] - n[1]], [a[0] - n[0], a[1] - n[1]], [a[0] + n[0], a[1] + n[1]]]]);
  });
  return polygonClipping.union(pieces[0], ...pieces.slice(1));
}

const isClosedBuilding = (w: OsmWay) => isBuilding(w.tags) && w.refs.length >= 4 && w.refs[0] === w.refs[w.refs.length - 1];

function setup(road: readonly LonLatPoint[], width: number) {
  const lat0 = road[0]?.lat ?? 0;
  const f = frame(lat0);
  const pts = road.map((p) => f.to(p.lon, p.lat));
  const half = width / 2 + CLEARANCE_MARGIN;
  const strip = corridor(pts, half);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const box = { x0: Math.min(...xs) - half, x1: Math.max(...xs) + half, y0: Math.min(...ys) - half, y1: Math.max(...ys) + half };
  return { f, strip, box };
}

function outline(doc: OsmDoc, w: OsmWay, f: ReturnType<typeof frame>): P[] | null {
  const ring = w.refs.map((r) => doc.nodes[r]).filter(Boolean).map((n) => f.to(n.lon, n.lat));
  return ring.length >= 4 ? ring : null;
}

export interface BuildingConflict {
  readonly wayId: string;
  /** Area of the building under the corridor, m². */
  readonly overlap: number;
}

/** Buildings the road would run into, with how much of each lies under its corridor. */
export function buildingConflicts(doc: OsmDoc, road: readonly LonLatPoint[], width: number): BuildingConflict[] {
  if (road.length < 2) return [];
  const { f, strip, box } = setup(road, width);
  const out: BuildingConflict[] = [];
  for (const w of Object.values(doc.ways)) {
    if (!isClosedBuilding(w)) continue;
    const ring = outline(doc, w, f);
    if (!ring || ring.every((p) => p[0] < box.x0) || ring.every((p) => p[0] > box.x1) || ring.every((p) => p[1] < box.y0) || ring.every((p) => p[1] > box.y1)) continue;
    const overlap = area(polygonClipping.intersection([ring], strip));
    if (overlap > MIN_OVERLAP) out.push({ wayId: w.id, overlap });
  }
  return out;
}

/** Nodes of the way that nothing else uses and that carry no tags. */
function orphanNodes(doc: OsmDoc, way: OsmWay): string[] {
  const used = new Set<string>();
  Object.values(doc.ways).forEach((w) => { if (w.id !== way.id) w.refs.forEach((r) => used.add(r)); });
  return [...new Set(way.refs)].filter((r) => !used.has(r) && !Object.keys(doc.nodes[r]?.tags ?? {}).length);
}

function removeBuilding(doc: OsmDoc, way: OsmWay): OsmDoc {
  const orphans = orphanNodes(doc, way);
  return orphans.reduce((d, id) => deleteNode(d, id), deleteWay(doc, way.id));
}

/** Buildings demolished for the road, with their nodes. */
export function demolishBuildings(doc: OsmDoc, ids: readonly string[]): OsmDoc {
  return ids.reduce((d, id) => (d.ways[id] ? removeBuilding(d, d.ways[id]) : d), doc);
}

/**
 * Buildings cut along the road: the part under the corridor goes; what is left keeps the tags.
 * A building cut in two becomes two buildings; slivers and buildings with nothing left go.
 */
export function cutBuildings(doc: OsmDoc, ids: readonly string[], road: readonly LonLatPoint[], width: number): OsmDoc {
  if (road.length < 2) return doc;
  const { f, strip } = setup(road, width);
  let d = doc;
  for (const id of ids) {
    const way = d.ways[id];
    if (!way || !isClosedBuilding(way)) continue;
    const ring = outline(d, way, f);
    if (!ring) continue;
    const parts = polygonClipping.difference([ring], strip).filter((poly) => area([poly]) >= MIN_PART_AREA);
    const tags = way.tags;
    d = removeBuilding(d, way);
    for (const poly of parts) {
      // Outer ring only: a courtyard left by the cut is rare and would need a multipolygon.
      const outer = poly[0].slice(0, -1);
      let refs: string[] = [];
      for (const p of outer) {
        const [lon, lat] = f.back(p as P);
        const added = addNode(d, lon, lat);
        d = added.doc;
        refs = [...refs, added.id];
      }
      d = createWay(d, [...refs, refs[0]], tags).doc;
    }
  }
  return d;
}
