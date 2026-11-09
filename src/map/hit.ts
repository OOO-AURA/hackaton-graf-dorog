import type { Map as MapLibreMap, PointLike } from 'maplibre-gl';
import { projectOnSegment } from '../osm/geo';
import type { OsmDoc } from '../osm/types';
import { HIT_LAYERS, sceneOf } from './layers';
import { SCENE3D_LAYER } from './scene3d';

const HIT_TOLERANCE_PX = 7;

export interface WayHit {
  readonly wayId: string;
  /** Segment index: the point lies between refs[index] and refs[index + 1]. */
  readonly index: number;
  readonly lon: number;
  readonly lat: number;
}

const box = (p: { x: number; y: number }): [PointLike, PointLike] => [
  [p.x - HIT_TOLERANCE_PX, p.y - HIT_TOLERANCE_PX],
  [p.x + HIT_TOLERANCE_PX, p.y + HIT_TOLERANCE_PX],
];

export function hitNode(map: MapLibreMap, point: { x: number; y: number }, exclude?: string): string | null {
  const features = map.queryRenderedFeatures(box(point), { layers: [...HIT_LAYERS.nodes] });
  const ids = features.map((f) => String(f.properties?.id)).filter((id) => id !== exclude);
  return ids[0] ?? null;
}

/** Nearest point on any rendered road within tolerance, measured in screen pixels. */
export function hitWay(map: MapLibreMap, doc: OsmDoc, point: { x: number; y: number }): WayHit | null {
  const features = map.queryRenderedFeatures(box(point), { layers: [...HIT_LAYERS.roads] });
  let best: (WayHit & { dist2: number }) | null = null;
  for (const wayId of new Set(features.map((f) => String(f.properties?.id)))) {
    const way = doc.ways[wayId];
    if (!way) continue;
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

/**
 * Building under a point: in 3D the scene layer renders what is under the cursor, in 2D the flat
 * building layer is queried. Resolves to the OSM way id or null.
 */
export async function hitBuilding(map: MapLibreMap, point: { x: number; y: number }): Promise<string | null> {
  if (map.getLayoutProperty(SCENE3D_LAYER, 'visibility') === 'visible') return (await sceneOf(map)?.pick(point.x, point.y)) ?? null;
  const features = map.queryRenderedFeatures([point.x, point.y], { layers: ['buildings'] });
  return features.length ? String(features[0].properties?.id) : null;
}
