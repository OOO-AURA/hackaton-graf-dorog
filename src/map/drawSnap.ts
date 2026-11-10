import type { Map as MapLibreMap } from 'maplibre-gl';
import type { OsmDoc } from '../osm/types';
import type { DrawPoint } from '../osm/draw';
import { bearingDeg, distanceM, snapAngle, turnDeg } from '../osm/drawGeometry';
import { hitNode, hitWay } from './hit';
import { isRailLine } from '../osm/rail';
import { isDrivable } from '../osm/tags';

/**
 * Where the next point of a road being drawn goes. Like a city builder: it is pulled onto a node
 * nearby (the road joins it), else onto a road nearby (a new junction there), else the new segment
 * turns onto a round angle from the one before (15° steps, always with Shift).
 */

export type DrawSnap = 'node' | 'way' | 'angle' | null;

export interface DrawTarget extends DrawPoint {
  readonly snap: DrawSnap;
  /** Turn from the segment before, degrees, positive to the right; null for the first segment. */
  readonly turn: number | null;
  /** Length of the new segment, metres. */
  readonly length: number | null;
}

/** Magnet radius around nodes and roads, screen pixels: wider than a click, so the road finds them. */
const MAGNET_NODE_PX = 18;
const MAGNET_WAY_PX = 12;

export function drawTarget(
  map: MapLibreMap, doc: OsmDoc, point: { x: number; y: number }, lngLat: { lng: number; lat: number },
  drawing: readonly DrawPoint[], force: boolean, rail = false,
): DrawTarget {
  const last = drawing[drawing.length - 1];
  const prev = drawing[drawing.length - 2];
  const measured = (p: { lon: number; lat: number }) => ({
    length: last ? distanceM(last, p) : null,
    turn: last && prev ? turnDeg(bearingDeg(prev, last), bearingDeg(last, p)) : null,
  });
  // A road snaps to roads and a track to tracks: the two networks are not joined.
  const fits = (wayIds: string[]) => wayIds.length === 0 || wayIds.some((id) => isRailLine(doc.ways[id].tags) === rail);
  const waysAt = (id: string) => Object.values(doc.ways).filter((w) => w.refs.includes(id) && (isDrivable(w.tags) || isRailLine(w.tags))).map((w) => w.id);
  const nodeId = hitNode(map, point, undefined, MAGNET_NODE_PX);
  if (nodeId && doc.nodes[nodeId] && nodeId !== last?.nodeId && fits(waysAt(nodeId))) {
    const n = doc.nodes[nodeId];
    return { lon: n.lon, lat: n.lat, nodeId, snap: 'node', ...measured(n) };
  }
  const hit = hitWay(map, doc, point, MAGNET_WAY_PX);
  const way = hit && isRailLine(doc.ways[hit.wayId].tags) === rail ? hit : null;
  if (way) return { lon: way.lon, lat: way.lat, wayId: way.wayId, snap: 'way', ...measured(way) };
  const free = { lon: lngLat.lng, lat: lngLat.lat };
  if (!last) return { ...free, snap: null, turn: null, length: null };
  const r = snapAngle(last, free, prev ? bearingDeg(prev, last) : null, force);
  return { ...r.point, snap: r.snapped ? 'angle' : null, turn: r.turn, length: distanceM(last, r.point) };
}
