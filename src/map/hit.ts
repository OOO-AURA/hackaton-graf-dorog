import type { Map as MapLibreMap, PointLike } from 'maplibre-gl';
import { projectOnSegment } from '../osm/geo';
import type { OsmDoc } from '../osm/types';
import { HIT_LAYERS, sceneOf } from './layers';
import { SCENE3D_LAYER } from './scene3d';
import { canPickNode, canPickWay } from './editScope';
import { useUi } from '../state/ui';
import { useEditor } from '../state/store';

const HIT_TOLERANCE_PX = 7;

export interface WayHit {
  readonly wayId: string;
  /** Segment index: the point lies between refs[index] and refs[index + 1]. */
  readonly index: number;
  readonly lon: number;
  readonly lat: number;
}

const box = (p: { x: number; y: number }, tol = HIT_TOLERANCE_PX): [PointLike, PointLike] => [
  [p.x - tol, p.y - tol],
  [p.x + tol, p.y + tol],
];

/** Node under a point, the nearest one within `tol` px that `accept` takes; drawing uses a wider magnet. */
export function hitNode(map: MapLibreMap, point: { x: number; y: number }, exclude?: string, tol = HIT_TOLERANCE_PX, accept?: (id: string) => boolean): string | null {
  const features = map.queryRenderedFeatures(box(point, tol), { layers: [...HIT_LAYERS.nodes] });
  let best: { id: string; d: number } | null = null;
  for (const f of features) {
    const id = String(f.properties?.id);
    if (id === exclude || f.geometry.type !== 'Point' || (accept && !accept(id))) continue;
    const at = map.project(f.geometry.coordinates as [number, number]);
    const d = Math.hypot(at.x - point.x, at.y - point.y);
    if (!best || d < best.d) best = { id, d };
  }
  return best?.id ?? null;
}

/** Nearest point on any rendered road within tolerance, measured in screen pixels. */
export function hitWay(map: MapLibreMap, doc: OsmDoc, point: { x: number; y: number }, tol = HIT_TOLERANCE_PX, accept?: (id: string) => boolean): WayHit | null {
  // In 3D bridges are decks of the scene layer: the flat line on the ground does not take clicks.
  const layers = in3d(map) ? HIT_LAYERS.roads.filter((l) => l !== 'roads-bridge') : [...HIT_LAYERS.roads];
  const features = map.queryRenderedFeatures(box(point, tol), { layers });
  let best: (WayHit & { dist2: number }) | null = null;
  for (const wayId of new Set(features.map((f) => String(f.properties?.id)))) {
    const way = doc.ways[wayId];
    if (!way || (accept && !accept(wayId))) continue;
    const screen = way.refs.map((r) => map.project([doc.nodes[r].lon, doc.nodes[r].lat]));
    for (let i = 0; i < screen.length - 1; i += 1) {
      const { t, dist2 } = projectOnSegment([point.x, point.y], [screen[i].x, screen[i].y], [screen[i + 1].x, screen[i + 1].y]);
      if (best && dist2 >= best.dist2) continue;
      const a = doc.nodes[way.refs[i]];
      const b = doc.nodes[way.refs[i + 1]];
      best = { wayId, index: i, lon: a.lon + (b.lon - a.lon) * t, lat: a.lat + (b.lat - a.lat) * t, dist2 };
    }
  }
  return best && { wayId: best.wayId, index: best.index, lon: best.lon, lat: best.lat };
}

const in3d = (map: MapLibreMap) => map.getLayoutProperty(SCENE3D_LAYER, 'visibility') === 'visible';

/**
 * Building or bridge under a point: in 3D the scene layer renders what is under the cursor, in
 * 2D the flat building layer is queried. Resolves to the OSM way id or null.
 */
export async function hitBuilding(map: MapLibreMap, point: { x: number; y: number }): Promise<string | null> {
  if (in3d(map)) return (await sceneOf(map)?.pick(point.x, point.y)) ?? null;
  const features = map.queryRenderedFeatures([point.x, point.y], { layers: ['buildings'] });
  return features.length ? String(features[0].properties?.id) : null;
}

/** Node to pick with the select or view tool: only what the view mode lets one work on. */
export const pickNode = (map: MapLibreMap, point: { x: number; y: number }, exclude?: string): string | null => {
  const { doc } = useEditor.getState();
  const { lens } = useUi.getState();
  return hitNode(map, point, exclude, HIT_TOLERANCE_PX, (id) => canPickNode(doc, lens, id));
};

/** Road or track to pick with the select or view tool, in the view mode's scope. */
export const pickWay = (map: MapLibreMap, doc: OsmDoc, point: { x: number; y: number }): WayHit | null => {
  const { lens } = useUi.getState();
  return hitWay(map, doc, point, HIT_TOLERANCE_PX, (id) => canPickWay(doc, lens, id));
};

/** Whether a way may be picked in the current view mode. */
export const pickableWay = (doc: OsmDoc, id: string): boolean => canPickWay(doc, useUi.getState().lens, id);
