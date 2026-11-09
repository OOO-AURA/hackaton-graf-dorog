import type { Map as MapLibreMap } from 'maplibre-gl';

const EMPTY = { type: 'FeatureCollection', features: [] } as const;

export const SOURCES = ['buildings', 'context', 'roads', 'nodes', 'selection', 'issues', 'draw'] as const;
export type SourceId = (typeof SOURCES)[number];

export const HIT_LAYERS = { nodes: ['nodes'], roads: ['roads', 'roads-bridge'] } as const;

function addArrowImage(map: MapLibreMap): void {
  const size = 24;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#212529';
  ctx.beginPath();
  ctx.moveTo(6, 5); ctx.lineTo(18, 12); ctx.lineTo(6, 19); ctx.lineTo(9, 12);
  ctx.closePath();
  ctx.fill();
  map.addImage('arrow', ctx.getImageData(0, 0, size, size), { pixelRatio: 2 });
}

/** Road width grows with zoom and lane count; `extra` px is added for casings and highlights. */
const laneWidth = (extra: unknown = 0) => [
  'interpolate', ['exponential', 2], ['zoom'],
  13, ['+', ['*', 0.5, ['get', 'lanes']], extra],
  18, ['+', ['*', 4, ['get', 'lanes']], extra],
] as never;

export function addEditorLayers(map: MapLibreMap): void {
  SOURCES.forEach((id) => map.addSource(id, { type: 'geojson', data: EMPTY as never }));
  addArrowImage(map);

  map.addLayer({ id: 'buildings', type: 'fill', source: 'buildings', paint: { 'fill-color': '#868e96', 'fill-opacity': 0.25, 'fill-outline-color': '#495057' } });
  map.addLayer({
    id: 'context', type: 'line', source: 'context',
    paint: {
      'line-color': ['match', ['get', 'kind'], 'rail', '#5f3dc4', '#adb5bd'],
      'line-width': ['match', ['get', 'kind'], 'rail', 2, 1],
      'line-dasharray': [2, 2],
    },
  });
  map.addLayer({
    id: 'roads-casing', type: 'line', source: 'roads', layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['case', ['get', 'bridge'], '#000000', '#495057'], 'line-width': laneWidth(['case', ['get', 'bridge'], 5, 2]) },
  });
  map.addLayer({
    id: 'roads', type: 'line', source: 'roads', filter: ['!', ['get', 'bridge']], layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': laneWidth(), 'line-opacity': ['case', ['get', 'tunnel'], 0.5, 1] },
  });
  map.addLayer({
    id: 'roads-bridge', type: 'line', source: 'roads', filter: ['get', 'bridge'], layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': laneWidth() },
  });
  map.addLayer({
    id: 'roads-arrows', type: 'symbol', source: 'roads', filter: ['!=', ['get', 'dir'], 'both'], minzoom: 15,
    layout: {
      'symbol-placement': 'line', 'symbol-spacing': 60, 'icon-image': 'arrow', 'icon-allow-overlap': true,
      'icon-rotate': ['case', ['==', ['get', 'dir'], 'backward'], 180, 0],
    },
  });
  map.addLayer({
    id: 'selection-line', type: 'line', source: 'selection', filter: ['==', ['geometry-type'], 'LineString'],
    paint: { 'line-color': '#1c7ed6', 'line-width': laneWidth(8), 'line-opacity': 0.45 },
  }, 'roads-casing');
  map.addLayer({
    id: 'nodes', type: 'circle', source: 'nodes',
    filter: ['any', ['in', ['get', 'kind'], ['literal', ['signal', 'junction', 'end', 'vertex']]], ['>=', ['zoom'], 17]],
    minzoom: 14,
    paint: {
      'circle-radius': ['match', ['get', 'kind'], 'signal', 6, 'junction', 4, 'vertex', 4, 3],
      'circle-color': ['match', ['get', 'kind'], 'signal', '#e03131', 'junction', '#ffffff', 'end', '#ffd43b', 'vertex', '#1c7ed6', '#dee2e6'],
      'circle-stroke-color': '#212529',
      'circle-stroke-width': ['match', ['get', 'kind'], 'signal', 2, 1],
    },
  });
  map.addLayer({
    id: 'selection-node', type: 'circle', source: 'selection', filter: ['==', ['geometry-type'], 'Point'],
    paint: { 'circle-radius': 9, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#1c7ed6', 'circle-stroke-width': 3 },
  });
  map.addLayer({
    id: 'issues', type: 'circle', source: 'issues',
    paint: {
      'circle-radius': ['case', ['get', 'focused'], 16, 10],
      'circle-color': ['match', ['get', 'severity'], 'error', 'rgba(224,49,49,0.25)', 'rgba(247,103,7,0.25)'],
      'circle-stroke-color': ['match', ['get', 'severity'], 'error', '#e03131', '#f76707'],
      'circle-stroke-width': ['case', ['get', 'focused'], 3, 2],
    },
  });
  map.addLayer({ id: 'draw-line', type: 'line', source: 'draw', paint: { 'line-color': '#1c7ed6', 'line-width': 3, 'line-dasharray': [2, 1] } });
  map.addLayer({ id: 'draw-points', type: 'circle', source: 'draw', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 5, 'circle-color': '#1c7ed6' } });
}
