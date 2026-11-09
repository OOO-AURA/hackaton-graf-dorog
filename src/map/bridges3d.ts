/**
 * Bridges in the 3D view: an elevated deck, earth embankments that rise smoothly on the approaches,
 * and piers under the span.
 *
 * Heights follow the Webots OSM importer, which lifts a way by `layer × 5 m` (its --layer-height
 * default). So the editor shows the bridge at the same height the jury will see on the Webots video,
 * and the road under it stays on the ground. The ramps exist only in the editor view: OSM has no
 * per-vertex height, and Webots raises the whole bridge way at once.
 */
import type { Feature, FeatureCollection, Polygon } from 'geojson';
import { haversine, type LonLat } from '../osm/geo';
import { direction, isDrivable } from '../osm/tags';
import type { OsmDoc, OsmWay } from '../osm/types';

/** Same as the Webots importer default (`--layer-height 5`). */
export const LAYER_HEIGHT_M = 5;
const DECK_THICKNESS_M = 1.2;
/** Length of the approach embankment: 5 m over 70 m is a 7% grade, usual for a city overpass. */
export const RAMP_LENGTH_M = 70;
const RAMP_STEP_M = 3.5;
const PIER_SPACING_M = 18;
const PIER_SIZE_M = 1.6;
const LANE_WIDTH_M = 3.5;
const SHOULDER_M = 1.5;
const FOOT_WIDTH_M = 3;
const METRES_PER_DEG_LAT = 110_540;
const METRES_PER_DEG_LON_EQUATOR = 111_320;

export type Part = 'deck' | 'ramp' | 'pier';
export interface BridgeProps { part: Part; wayId: string; highway: string; base: number; height: number }
type BridgeFeature = Feature<Polygon, BridgeProps>;

export const isBridge = (w: OsmWay) => Boolean(w.tags.bridge && w.tags.bridge !== 'no');

/** Deck height in metres: the way's layer (at least 1) times the Webots layer height. */
export function deckHeight(w: OsmWay): number {
  const layer = Number.parseFloat(w.tags.layer ?? '');
  return Math.max(1, Number.isFinite(layer) ? layer : 1) * LAYER_HEIGHT_M;
}

function roadWidth(w: OsmWay): number {
  const width = Number.parseFloat(w.tags.width ?? '');
  if (Number.isFinite(width) && width > 0) return width;
  if (!isDrivable(w.tags)) return FOOT_WIDTH_M;
  const lanes = Number.parseInt(w.tags.lanes ?? '', 10) || (direction(w.tags) === 'both' ? 2 : 1);
  return lanes * LANE_WIDTH_M + SHOULDER_M;
}

/** Local metric frame around a latitude; good to centimetres inside a city. */
function frame(lat: number) {
  const kx = METRES_PER_DEG_LON_EQUATOR * Math.cos((lat * Math.PI) / 180);
  return {
    toXY: ([lon, lat2]: LonLat): [number, number] => [lon * kx, lat2 * METRES_PER_DEG_LAT],
    toLonLat: ([x, y]: [number, number]): [number, number] => [x / kx, y / METRES_PER_DEG_LAT],
  };
}

/** Rectangle around segment a→b with the given half width, as a closed lon/lat ring. */
function segmentQuad(a: LonLat, b: LonLat, halfWidth: number): [number, number][] {
  const f = frame((a[1] + b[1]) / 2);
  const [ax, ay] = f.toXY(a);
  const [bx, by] = f.toXY(b);
  const len = Math.hypot(bx - ax, by - ay) || 1;
  const nx = (-(by - ay) / len) * halfWidth;
  const ny = ((bx - ax) / len) * halfWidth;
  const ring: [number, number][] = [[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]];
  const lonLat = ring.map(f.toLonLat);
  return [...lonLat, lonLat[0]];
}

function squareAt(p: LonLat, size: number): [number, number][] {
  const f = frame(p[1]);
  const [x, y] = f.toXY(p);
  const h = size / 2;
  const ring = ([[x - h, y - h], [x + h, y - h], [x + h, y + h], [x - h, y + h]] as [number, number][]).map(f.toLonLat);
  return [...ring, ring[0]];
}

const poly = (ring: [number, number][], props: BridgeProps): BridgeFeature =>
  ({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [ring] } });

const coordsOf = (doc: OsmDoc, refs: readonly string[]): LonLat[] =>
  refs.filter((r) => doc.nodes[r]).map((r) => [doc.nodes[r].lon, doc.nodes[r].lat] as LonLat);

/** Point at distance `s` along a polyline. */
function pointAt(pts: readonly LonLat[], s: number): LonLat {
  let left = s;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const seg = haversine(pts[i], pts[i + 1]);
    if (left <= seg || i === pts.length - 2) {
      const t = seg ? Math.min(1, left / seg) : 0;
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
    }
    left -= seg;
  }
  return pts[pts.length - 1];
}

const lengthOf = (pts: readonly LonLat[]) => pts.slice(1).reduce((s, p, i) => s + haversine(pts[i], p), 0);

/** Same kind of way: road to road, footway to footway, so a road ramp does not climb a footpath. */
const sameKind = (a: OsmWay, b: OsmWay) => isDrivable(a.tags) === isDrivable(b.tags) && Boolean(a.tags.railway) === Boolean(b.tags.railway);

/**
 * Ground path leaving the bridge end `nodeId`: the continuing way (same name first), walked away
 * from the bridge and followed into the next way when it is shorter than the ramp.
 */
function approachPath(doc: OsmDoc, bridge: OsmWay, nodeId: string, byNode: Map<string, OsmWay[]>): LonLat[] {
  const path: LonLat[] = [[doc.nodes[nodeId].lon, doc.nodes[nodeId].lat]];
  const used = new Set([bridge.id]);
  let at = nodeId;
  let prev = bridge;
  while (lengthOf(path) < RAMP_LENGTH_M) {
    const options = (byNode.get(at) ?? []).filter((w) => !used.has(w.id) && !isBridge(w) && sameKind(w, prev)
      && (w.refs[0] === at || w.refs[w.refs.length - 1] === at));
    const next = options.find((w) => w.tags.name && w.tags.name === bridge.tags.name) ?? (options.length === 1 ? options[0] : undefined);
    if (!next) break;
    used.add(next.id);
    const refs = next.refs[0] === at ? next.refs : [...next.refs].reverse();
    path.push(...coordsOf(doc, refs.slice(1)));
    at = refs[refs.length - 1];
    prev = next;
  }
  return path;
}

function rampFeatures(path: readonly LonLat[], top: number, halfWidth: number, w: OsmWay): BridgeFeature[] {
  const total = Math.min(RAMP_LENGTH_M, lengthOf(path));
  if (total < RAMP_STEP_M) return [];
  const steps = Math.ceil(total / RAMP_STEP_M);
  return Array.from({ length: steps }, (_, i) => {
    const s0 = (i * total) / steps;
    const s1 = ((i + 1) * total) / steps;
    // Linear grade from the deck down to the ground at the far end of the ramp.
    const height = top * (1 - (s0 + s1) / 2 / RAMP_LENGTH_M);
    return poly(segmentQuad(pointAt(path, s0), pointAt(path, s1), halfWidth), { part: 'ramp', wayId: w.id, highway: w.tags.highway ?? '', base: 0, height: Math.max(0.2, height) });
  });
}

function pierFeatures(pts: readonly LonLat[], deckBase: number, w: OsmWay): BridgeFeature[] {
  const total = lengthOf(pts);
  const count = Math.floor(total / PIER_SPACING_M);
  return Array.from({ length: count }, (_, i) => {
    const s = (total * (i + 1)) / (count + 1);
    return poly(squareAt(pointAt(pts, s), PIER_SIZE_M), { part: 'pier', wayId: w.id, highway: '', base: 0, height: deckBase });
  });
}

/** Decks, approach embankments and piers for every bridge way in the document. */
export function bridgeFeatures(doc: OsmDoc): FeatureCollection<Polygon, BridgeProps> {
  const ways = Object.values(doc.ways).filter((w) => (w.tags.highway || w.tags.railway) && w.refs.length > 1);
  const byNode = new Map<string, OsmWay[]>();
  ways.forEach((w) => w.refs.forEach((r) => byNode.set(r, [...(byNode.get(r) ?? []), w])));
  const features = ways.filter(isBridge).flatMap((w) => {
    const pts = coordsOf(doc, w.refs);
    if (pts.length < 2) return [];
    const top = deckHeight(w);
    const half = roadWidth(w) / 2;
    const deck = pts.slice(1).map((p, i) => poly(segmentQuad(pts[i], p, half), {
      part: 'deck', wayId: w.id, highway: (w.tags.highway ?? '').replace(/_link$/, ''), base: top - DECK_THICKNESS_M, height: top,
    }));
    const ends = [w.refs[0], w.refs[w.refs.length - 1]].filter((id) => doc.nodes[id]);
    const ramps = ends.flatMap((id) => rampFeatures(approachPath(doc, w, id, byNode), top, half, w));
    return [...deck, ...ramps, ...pierFeatures(pts, top - DECK_THICKNESS_M, w)];
  });
  return { type: 'FeatureCollection', features };
}
