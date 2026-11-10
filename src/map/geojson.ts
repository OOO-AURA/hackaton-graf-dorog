import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson';
import { buildingHeight as heightOf } from '../osm/building';
import { direction, highwayColor, isDrivable } from '../osm/tags';
import { nodeSymbol } from './features';
import { thematicProps } from './thematic';
import { pxPerMetreZ17, roadWidthMetres } from './lanesGeo';
import type { OsmDoc, OsmWay } from '../osm/types';

type Props = Record<string, string | number | boolean>;

const coords = (doc: OsmDoc, w: OsmWay) =>
  w.refs.filter((r) => doc.nodes[r]).map((r) => [doc.nodes[r].lon, doc.nodes[r].lat]);

const lanesOf = (w: OsmWay) => Number.parseInt(w.tags.lanes ?? '', 10) || (direction(w.tags) === 'both' ? 2 : 1);

function roadFeature(doc: OsmDoc, w: OsmWay): Feature<LineString, Props> {
  return {
    type: 'Feature',
    id: Number(w.id),
    properties: {
      id: w.id,
      color: highwayColor(w.tags.highway ?? ''),
      highway: (w.tags.highway ?? '').replace(/_link$/, ''),
      lanes: lanesOf(w),
      // Width in screen pixels at zoom 17 (it doubles with every zoom step), so that close in the
      // road is as wide as its lanes.
      w17: roadWidthMetres(w.tags) * pxPerMetreZ17(doc.nodes[w.refs[0]]?.lat ?? 52),
      dir: direction(w.tags),
      bridge: Boolean(w.tags.bridge && w.tags.bridge !== 'no'),
      tunnel: Boolean(w.tags.tunnel && w.tags.tunnel !== 'no'),
      name: w.tags.name ?? '',
      ...thematicProps(w.tags),
    },
    geometry: { type: 'LineString', coordinates: coords(doc, w) },
  };
}

const collection = <G extends LineString | Point | Polygon>(features: Feature<G, Props>[]): FeatureCollection<G, Props> =>
  ({ type: 'FeatureCollection', features });

export function roadsGeoJson(doc: OsmDoc) {
  return collection(Object.values(doc.ways).filter((w) => isDrivable(w.tags) && w.refs.length > 1).map((w) => roadFeature(doc, w)));
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
    } else if (w.tags.railway || w.tags.highway) {
      lines.push({ type: 'Feature', properties: { id: w.id, kind: w.tags.railway ? 'rail' : 'path' }, geometry: { type: 'LineString', coordinates: c } });
    }
  });
  return { lines: collection(lines), buildings: collection(polygons) };
}

/** Nodes of the road graph: intersections, ends, signals; plus every vertex of the selected way. */
export function nodesGeoJson(doc: OsmDoc, selectedWay: string | null) {
  const usage = new Map<string, number>();
  const ends = new Set<string>();
  Object.values(doc.ways).forEach((w) => {
    if (!isDrivable(w.tags)) return;
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
