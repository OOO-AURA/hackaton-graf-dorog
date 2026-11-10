import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import type { OsmDoc } from '../osm/types';
import { isDrivable } from '../osm/tags';
import { placeSign, signDef } from '../osm/trafficSigns';
import { roadWidthMetres } from './lanesGeo';
import { frame } from './polyline';
import { hitWay } from './hit';

/**
 * Putting road signs on the map: the sign follows the cursor, sticks to the nearest road and
 * stands on its edge, on the side the cursor is on. Signs stand on the right of the traffic they
 * face, so the side says which way of a two-way road the sign is for. A click puts a node on the
 * road there with the sign's tags (osm/trafficSigns.ts).
 */

/** How far from a road, in screen pixels, a sign still sticks to it. */
const MAGNET_PX = 34;
/** A bare node of the road this close, metres, carries the sign instead of a new one. */
const REUSE_M = 2;
const SIDE_GAP = 1.5;

export interface SignSnap {
  readonly wayId: string;
  readonly index: number;
  /** Point on the road's line where the node goes. */
  readonly lon: number;
  readonly lat: number;
  /** Where the sign is drawn: on the road edge. */
  readonly edge: [number, number];
  /** For traffic in the way's direction. */
  readonly forward: boolean;
  /** An existing bare node to carry it. */
  readonly near: string | null;
}

export function signSnap(map: MapLibreMap, doc: OsmDoc, point: { x: number; y: number }, lngLat: { lng: number; lat: number }): SignSnap | null {
  const hit = hitWay(map, doc, point, MAGNET_PX, (id) => isDrivable(doc.ways[id]?.tags ?? {}));
  if (!hit) return null;
  const way = doc.ways[hit.wayId];
  const [a, b] = [doc.nodes[way.refs[hit.index]], doc.nodes[way.refs[hit.index + 1]]];
  const f = frame(hit.lat);
  const [pa, pb, ph, pc] = [f.to(a.lon, a.lat), f.to(b.lon, b.lat), f.to(hit.lon, hit.lat), f.to(lngLat.lng, lngLat.lat)];
  const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) || 1;
  const t: [number, number] = [(pb[0] - pa[0]) / len, (pb[1] - pa[1]) / len];
  // Cursor on the right of the way's direction: the sign is for traffic going along the way.
  const cross = t[0] * (pc[1] - ph[1]) - t[1] * (pc[0] - ph[0]);
  const forward = cross <= 0;
  const side = roadWidthMetres(way.tags) / 2 + SIDE_GAP;
  const right: [number, number] = [t[1], -t[0]];
  const s = forward ? 1 : -1;
  const edge = f.back([ph[0] + right[0] * side * s, ph[1] + right[1] * side * s]);
  const near = [a, b].find((n) => {
    const p = f.to(n.lon, n.lat);
    return Math.hypot(p[0] - ph[0], p[1] - ph[1]) <= REUSE_M && !Object.keys(n.tags).some((k) => k !== 'traffic_sign' && k !== 'direction');
  })?.id ?? null;
  return { wayId: hit.wayId, index: hit.index, lon: hit.lon, lat: hit.lat, edge: [edge[0], edge[1]], forward, near };
}

/** The sign that would be put, drawn half see-through where it would stand. */
export function showSignGhost(map: MapLibreMap, snap: SignSnap | null, code: string | null, value?: number): void {
  const src = map.getSource('sign-ghost') as GeoJSONSource | undefined;
  if (!src) return;
  if (!snap || !code) { src.setData({ type: 'FeatureCollection', features: [] }); return; }
  const icon = `road-sign-ts:${code}${signDef(code)?.value ? `:${Math.round(value ?? signDef(code)!.value!.default)}` : ''}`;
  src.setData({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { kind: 'stem' }, geometry: { type: 'LineString', coordinates: [[snap.lon, snap.lat], snap.edge] } },
      { type: 'Feature', properties: { kind: 'foot' }, geometry: { type: 'Point', coordinates: [snap.lon, snap.lat] } },
      { type: 'Feature', properties: { kind: 'sign', icon }, geometry: { type: 'Point', coordinates: snap.edge } },
    ],
  });
}

/** Puts the sign; returns the document and the node it stands on. */
export function putSign(doc: OsmDoc, snap: SignSnap, code: string, value?: number): { doc: OsmDoc; nodeId: string | null } {
  const def = signDef(code);
  if (!def) return { doc, nodeId: null };
  return placeSign(doc, snap.wayId, snap.index, snap.lon, snap.lat, def, snap.forward, value, snap.near);
}
