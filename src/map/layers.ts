import type { Map as MapLibreMap } from 'maplibre-gl';
import type { LayerId } from '../state/ui';
import { roadColorExpression, type MapPalette } from './palette';

const EMPTY = { type: 'FeatureCollection', features: [] } as const;

export const SOURCES = ['buildings', 'context', 'roads', 'nodes', 'selection', 'issues', 'draw'] as const;
export type SourceId = (typeof SOURCES)[number];

export const HIT_LAYERS = { nodes: ['signals', 'signs', 'crossings', 'nodes'], roads: ['roads', 'roads-bridge'] } as const;

function arrowImage(color: string): ImageData | null {
  const size = 24;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(6, 5); ctx.lineTo(18, 12); ctx.lineTo(6, 19); ctx.lineTo(9, 12);
  ctx.closePath();
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

/** Small road-sign icons drawn on a 32px canvas (shown at 16 css px). */
const SIGN_ICONS: Record<string, (c: CanvasRenderingContext2D) => void> = {
  crossing: (c) => {
    c.fillStyle = '#3F8BC4'; c.fillRect(3, 3, 26, 26); c.strokeStyle = '#FFFFFF'; c.lineWidth = 2; c.strokeRect(4, 4, 24, 24);
    c.fillStyle = '#FFFFFF'; for (let x = 8; x < 26; x += 5) c.fillRect(x, 18, 3, 7);
    c.beginPath(); c.arc(16, 9, 2.5, 0, Math.PI * 2); c.fill(); c.fillRect(15, 11, 2, 6);
  },
  bump: (c) => {
    c.fillStyle = '#F0BC2A'; c.strokeStyle = '#3A2516'; c.lineWidth = 2.5;
    c.beginPath(); c.moveTo(16, 3); c.lineTo(29, 28); c.lineTo(3, 28); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = '#3A2516'; c.beginPath(); c.ellipse(16, 23, 7, 3.5, 0, Math.PI, 0); c.fill(); c.fillRect(8, 23, 16, 2);
  },
};

function addSignImages(map: MapLibreMap): void {
  Object.entries(SIGN_ICONS).forEach(([name, draw]) => {
    const canvas = document.createElement('canvas');
    canvas.width = 32; canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    draw(ctx);
    if (!map.hasImage(`sign-${name}`)) map.addImage(`sign-${name}`, ctx.getImageData(0, 0, 32, 32), { pixelRatio: 2 });
  });
}

function setArrowImage(map: MapLibreMap, color: string): void {
  const image = arrowImage(color);
  if (!image) return;
  if (map.hasImage('arrow')) map.updateImage('arrow', image);
  else map.addImage('arrow', image, { pixelRatio: 2 });
}

/** Road width grows with zoom and lane count; `extra` px is added for casings and highlights. */
const laneWidth = (extra: unknown = 0) => [
  'interpolate', ['exponential', 2], ['zoom'],
  13, ['+', ['*', 0.5, ['get', 'lanes']], extra],
  18, ['+', ['*', 4, ['get', 'lanes']], extra],
] as never;

const GRAPH_NODE_KINDS = ['junction', 'end', 'vertex'];
const NODES_FILTER = ['all', ['!=', ['get', 'kind'], 'signal'], ['any', ['in', ['get', 'kind'], ['literal', GRAPH_NODE_KINDS]], ['>=', ['zoom'], 17]]];

export function addEditorLayers(map: MapLibreMap, p: MapPalette): void {
  SOURCES.forEach((id) => map.addSource(id, { type: 'geojson', data: EMPTY as never }));
  setArrowImage(map, p.arrow);
  addSignImages(map);

  map.addLayer({ id: 'buildings', type: 'fill', source: 'buildings', paint: { 'fill-opacity': 0.55 } });
  map.addLayer({ id: 'context', type: 'line', source: 'context', filter: ['!=', ['get', 'kind'], 'rail'], paint: { 'line-width': 1, 'line-dasharray': [2, 2] } });
  map.addLayer({ id: 'tram', type: 'line', source: 'context', filter: ['==', ['get', 'kind'], 'rail'], paint: { 'line-width': 2, 'line-dasharray': [3, 1.5] } });
  map.addLayer({ id: 'roads-casing', type: 'line', source: 'roads', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': laneWidth(['case', ['get', 'bridge'], 5, 2]) } });
  map.addLayer({
    id: 'roads', type: 'line', source: 'roads', filter: ['!', ['get', 'bridge']], layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-width': laneWidth(), 'line-opacity': ['case', ['get', 'tunnel'], 0.45, 1] },
  });
  map.addLayer({ id: 'roads-bridge', type: 'line', source: 'roads', filter: ['get', 'bridge'], layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-width': laneWidth() } });
  map.addLayer({ id: 'selection-line', type: 'line', source: 'selection', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 13, 6, 18, 26], 'line-opacity': 0.55 } }, 'roads-casing');
  map.addLayer({
    id: 'roads-arrows', type: 'symbol', source: 'roads', filter: ['!=', ['get', 'dir'], 'both'], minzoom: 15,
    layout: { 'symbol-placement': 'line', 'symbol-spacing': 60, 'icon-image': 'arrow', 'icon-allow-overlap': true, 'icon-rotate': ['case', ['==', ['get', 'dir'], 'backward'], 180, 0] },
  });
  map.addLayer({
    id: 'nodes', type: 'circle', source: 'nodes', minzoom: 14,
    filter: NODES_FILTER as never,
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, ['match', ['get', 'kind'], 'vertex', 4, 1.8], 17, ['match', ['get', 'kind'], 'end', 3, 4]], 'circle-stroke-width': 1.2 },
  });
  const signLayout = (size: number) => ({ 'icon-image': ['concat', 'sign-', ['get', 'symbol']], 'icon-allow-overlap': true, 'icon-size': ['interpolate', ['linear'], ['zoom'], 14, size * 0.7, 18, size] }) as never;
  map.addLayer({ id: 'crossings', type: 'symbol', source: 'nodes', minzoom: 14, filter: ['==', ['get', 'symbol'], 'crossing'], layout: signLayout(1) });
  map.addLayer({ id: 'signs', type: 'symbol', source: 'nodes', minzoom: 14, filter: ['in', ['get', 'symbol'], ['literal', ['bump']]], layout: signLayout(1) });
  map.addLayer({ id: 'signals', type: 'circle', source: 'nodes', minzoom: 13, filter: ['==', ['get', 'kind'], 'signal'], paint: { 'circle-radius': 6, 'circle-stroke-width': 2 } });
  map.addLayer({ id: 'selection-node', type: 'circle', source: 'selection', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 10, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': 3 } });
  map.addLayer({ id: 'issues-halo', type: 'circle', source: 'issues', filter: ['any', ['get', 'focused'], ['!=', ['get', 'kind'], 'cordon']], paint: { 'circle-radius': ['case', ['get', 'focused'], 22, 13], 'circle-opacity': 0.18, 'circle-blur': 0.4 } });
  map.addLayer({ id: 'issues', type: 'circle', source: 'issues', paint: {
    'circle-radius': ['case', ['get', 'focused'], 15, ['==', ['get', 'kind'], 'cordon'], 5, 9], 'circle-color': 'rgba(0,0,0,0)',
    'circle-stroke-width': ['case', ['get', 'focused'], 3, ['==', ['get', 'kind'], 'cordon'], 1.5, 2],
  } });
  map.addLayer({ id: 'draw-line', type: 'line', source: 'draw', paint: { 'line-width': 3, 'line-dasharray': [2, 1] } });
  map.addLayer({ id: 'draw-points', type: 'circle', source: 'draw', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 5, 'circle-stroke-width': 2 } });
  applyPalette(map, p);
}

/** Colours every editor layer for the current theme; called on load and on theme change. */
export function applyPalette(map: MapLibreMap, p: MapPalette): void {
  const set = (layer: string, prop: string, value: unknown) => map.setPaintProperty(layer, prop as never, value as never);
  const issueColor = ['case', ['==', ['get', 'kind'], 'cordon'], p.cordon, ['==', ['get', 'severity'], 'error'], p.error, p.warning];
  setArrowImage(map, p.arrow);
  set('buildings', 'fill-color', p.building);
  set('buildings', 'fill-outline-color', p.buildingLine);
  set('context', 'line-color', p.path);
  set('tram', 'line-color', p.tram);
  set('roads-casing', 'line-color', ['case', ['get', 'bridge'], p.bridgeCasing, p.casing]);
  set('roads', 'line-color', roadColorExpression(p));
  set('roads-bridge', 'line-color', roadColorExpression(p));
  set('selection-line', 'line-color', p.selection);
  set('nodes', 'circle-color', ['match', ['get', 'kind'], 'end', p.roads.secondary, 'vertex', p.vertex, p.nodeFill]);
  set('nodes', 'circle-stroke-color', p.nodeStroke);
  set('signals', 'circle-color', p.signal);
  set('signals', 'circle-stroke-color', p.nodeStroke);
  set('selection-node', 'circle-stroke-color', p.selection);
  set('issues-halo', 'circle-color', issueColor);
  set('issues', 'circle-stroke-color', issueColor);
  set('draw-line', 'line-color', p.draw);
  set('draw-points', 'circle-color', p.nodeFill);
  set('draw-points', 'circle-stroke-color', p.draw);
}

const ROAD_LAYERS = ['roads-casing', 'roads', 'roads-bridge', 'roads-arrows', 'selection-line'];

/** Applies the layer toggles from the bottom bar. Bridges and tunnels are filters on the road layers. */
export function applyLayerVisibility(map: MapLibreMap, on: Record<LayerId, boolean>): void {
  const show = (layer: string, visible: boolean) => map.setLayoutProperty(layer, 'visibility', visible ? 'visible' : 'none');
  ROAD_LAYERS.forEach((l) => show(l, on.roads));
  show('roads-bridge', on.roads && on.bridges);
  // Vertices of the selected way stay visible and draggable even with junctions hidden.
  show('nodes', true);
  map.setFilter('nodes', (on.junctions ? NODES_FILTER : ['==', ['get', 'kind'], 'vertex']) as never);
  show('signals', on.signals);
  show('crossings', on.crossings);
  show('signs', on.signs);
  show('buildings', on.buildings);
  show('tram', on.tram);
  const structure: unknown[] = ['all'];
  if (!on.bridges) structure.push(['!', ['get', 'bridge']]);
  if (!on.tunnels) structure.push(['!', ['get', 'tunnel']]);
  map.setFilter('roads-casing', structure as never);
  map.setFilter('roads', ['all', ['!', ['get', 'bridge']], structure] as never);
  map.setFilter('roads-arrows', ['all', ['!=', ['get', 'dir'], 'both'], structure] as never);
}
