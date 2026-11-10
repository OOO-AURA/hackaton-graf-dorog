import { WayCache, sig } from './wayCache';
import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson';
import { buildingHeight as heightOf } from '../osm/building';
import { direction, highwayColor, isDrivable } from '../osm/tags';
import { nodeSymbol } from './features';
import { isRailLine, isRailWay, stationKind } from '../osm/rail';
import { thematicProps } from './thematic';
import type { OsmDoc, OsmWay } from '../osm/types';
import { pxPerMetreZ17 } from './lanesGeo';
import { cumulative, frame, slice } from './polyline';
import { roadTapers, sectionAt, sectionOf, taperBreaks, type Taper } from './section';

/** How far road pieces reach into their neighbours, metres. */
const OVERLAP = 0.3;

type Props = Record<string, string | number | boolean>;

const coords = (doc: OsmDoc, w: OsmWay) =>
  w.refs.filter((r) => doc.nodes[r]).map((r) => [doc.nodes[r].lon, doc.nodes[r].lat]);

const lanesOf = (w: OsmWay) => Number.parseInt(w.tags.lanes ?? '', 10) || (direction(w.tags) === 'both' ? 2 : 1);

/**
 * The road of a way as line features: one for the whole way, or, where it narrows into the next
 * road, the way up to the taper and short pieces of shrinking width along it. Widths are in screen
 * pixels at zoom 17 (doubling with every zoom step), so that close in the road is as wide as its
 * lanes: `w17` the carriageway, `o17` how far its middle lies to the right of the way's line
 * (a two-way road with more lanes one way is off-centre).
 */
function roadFeatures(doc: OsmDoc, w: OsmWay, tapers: readonly Taper[] | undefined): Feature<LineString, Props>[] {
  const props: Props = {
    id: w.id,
    color: highwayColor(w.tags.highway ?? ''),
    highway: (w.tags.highway ?? '').replace(/_link$/, ''),
    lanes: lanesOf(w),
    dir: direction(w.tags),
    bridge: Boolean(w.tags.bridge && w.tags.bridge !== 'no'),
    tunnel: Boolean(w.tags.tunnel && w.tags.tunnel !== 'no'),
    name: w.tags.name ?? '',
    ...thematicProps(w.tags),
  };
  const lonLat = coords(doc, w) as Array<[number, number]>;
  const px = pxPerMetreZ17(lonLat[0]?.[1] ?? 52);
  const f = frame(lonLat[0]?.[1] ?? 52);
  const pts = lonLat.map(([lon, lat]) => f.to(lon, lat));
  const total = cumulative(pts)[pts.length - 1] ?? 0;
  const base = sectionOf(w.tags);
  const feature = (from: number, to: number, taper: boolean): Feature<LineString, Props> => {
    const sec = sectionAt(base, tapers, (from + to) / 2, total);
    return {
      type: 'Feature',
      id: Number(w.id),
      properties: { ...props, w17: (sec.left + sec.right) * px, o17: ((sec.right - sec.left) / 2) * px, taper },
      // Pieces overlap a little: square-ended bridge pieces would show hairline seams between them.
      geometry: { type: 'LineString', coordinates: taper || from > 0 || to < total ? slice(pts, Math.max(0, from - OVERLAP), Math.min(total, to + OVERLAP)).map(f.back) : lonLat },
    };
  };
  if (!tapers?.length) return [feature(0, total, false)];
  const out: Feature<LineString, Props>[] = [];
  const startLen = tapers.find((t) => t.atStart)?.length ?? 0;
  const endLen = tapers.find((t) => !t.atStart)?.length ?? 0;
  out.push(feature(startLen, total - endLen, false));
  const breaks = taperBreaks(tapers, total);
  for (let i = 0; i + 1 < breaks.length; i += 1) {
    const [a, b] = [breaks[i], breaks[i + 1]];
    if (b - a > 1e-6 && (b <= startLen + 1e-6 || a >= total - endLen - 1e-6)) out.push(feature(a, b, true));
  }
  return out;
}

const collection = <G extends LineString | Point | Polygon>(features: Feature<G, Props>[]): FeatureCollection<G, Props> =>
  ({ type: 'FeatureCollection', features });

const roadCache = new WayCache<Feature<LineString, Props>[]>();

export function roadsGeoJson(doc: OsmDoc) {
  const tapers = roadTapers(doc);
  return collection(Object.values(doc.ways).filter((w) => isDrivable(w.tags) && w.refs.length > 1).flatMap((w) => {
    const t = tapers.get(w.id);
    return roadCache.get(doc, w, [sig(t)], () => roadFeatures(doc, w, t));
  }));
}

/** Building height in metres as Webots will build it, including its defaults per building type (see osm/building.ts). */
export function buildingHeight(tags: Record<string, string>): number {
  return heightOf(tags).metres;
}

/** Context layers that are not part of the road graph but go into the file (Webots uses them for 3D). */
export function contextGeoJson(doc: OsmDoc) {
  const lines: Feature<LineString, Props>[] = [];
  const polygons: Feature<Polygon, Props>[] = [];
  Object.values(doc.ways).forEach((w) => {
    if (isDrivable(w.tags) || w.refs.length < 2) return;
    const c = coords(doc, w);
    if (w.tags.building && c.length >= 4) {
      polygons.push({ type: 'Feature', properties: { id: w.id, height: buildingHeight(w.tags) }, geometry: { type: 'Polygon', coordinates: [c] } });
    } else if (w.tags.highway && !isRailWay(w.tags)) {
      lines.push({ type: 'Feature', properties: { id: w.id, kind: 'path' }, geometry: { type: 'LineString', coordinates: c } });
    }
  });
  return { lines: collection(lines), buildings: collection(polygons) };
}

const isYes = (v: string | undefined) => Boolean(v && v !== 'no');

/** Railway tracks and platforms, an editable layer of their own. */
export function railGeoJson(doc: OsmDoc) {
  const features: Feature<LineString, Props>[] = [];
  Object.values(doc.ways).forEach((w) => {
    if (w.refs.length < 2 || !isRailWay(w.tags)) return;
    features.push({
      type: 'Feature',
      properties: {
        id: w.id, kind: isRailLine(w.tags) ? (w.tags.railway as string) : 'platform', service: w.tags.service ?? '',
        bridge: isYes(w.tags.bridge), tunnel: isYes(w.tags.tunnel),
      },
      geometry: { type: 'LineString', coordinates: coords(doc, w) },
    });
  });
  return collection(features);
}

/** Railway stations, halts and tram stops with their names. */
export function stationGeoJson(doc: OsmDoc) {
  const features: Feature<Point, Props>[] = [];
  Object.values(doc.nodes).forEach((n) => {
    const kind = stationKind(n.tags);
    if (!kind) return;
    features.push({ type: 'Feature', properties: { id: n.id, kind, name: n.tags.name ?? '' }, geometry: { type: 'Point', coordinates: [n.lon, n.lat] } });
  });
  return collection(features);
}

/** Nodes of the road and rail graphs: intersections, ends, signals; plus every vertex of the selected way. */
export function nodesGeoJson(doc: OsmDoc, selectedWay: string | null) {
  const usage = new Map<string, number>();
  const ends = new Set<string>();
  Object.values(doc.ways).forEach((w) => {
    if (!isDrivable(w.tags) && !isRailLine(w.tags)) return;
    w.refs.forEach((r) => usage.set(r, (usage.get(r) ?? 0) + 1));
    ends.add(w.refs[0]);
    ends.add(w.refs[w.refs.length - 1]);
  });
  const selectedRefs = new Set(selectedWay ? doc.ways[selectedWay]?.refs ?? [] : []);
  const features: Feature<Point, Props>[] = [];
  usage.forEach((count, id) => {
    const n = doc.nodes[id];
    if (!n) return;
    const signal = n.tags.highway === 'traffic_signals';
    const kind = signal ? 'signal' : count > 1 ? 'junction' : ends.has(id) ? 'end' : selectedRefs.has(id) ? 'vertex' : 'shape';
    features.push({ type: 'Feature', id: Number(id), properties: { id, kind, crossing: n.tags.highway === 'crossing', symbol: nodeSymbol(n.tags) }, geometry: { type: 'Point', coordinates: [n.lon, n.lat] } });
  });
  return collection(features);
}

export function docBounds(doc: OsmDoc): [number, number, number, number] | null {
  if (doc.bounds?.minlon) {
    const b = doc.bounds;
    return [Number(b.minlon), Number(b.minlat), Number(b.maxlon), Number(b.maxlat)];
  }
  const nodes = Object.values(doc.nodes);
  if (!nodes.length) return null;
  const lons = nodes.map((n) => n.lon);
  const lats = nodes.map((n) => n.lat);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}
