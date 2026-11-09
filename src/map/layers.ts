import type { Map as MapLibreMap } from 'maplibre-gl';
import type { LayerId } from '../state/ui';
import { ROAD_CLASSES, roadColorExpression, type MapPalette } from './palette';
import { Scene3dLayer, SCENE3D_LAYER } from './scene3d';
import type { Rgb, Scene3dColors } from './mesh3d';

const EMPTY = { type: 'FeatureCollection', features: [] } as const;

export const SOURCES = ['buildings', 'context', 'roads', 'nodes', 'selection', 'issues', 'draw', 'vehicles', 'macro', 'signals', 'transit', 'lanes', 'lane-links', 'lane-ends'] as const;
export type SourceId = (typeof SOURCES)[number];

export const HIT_LAYERS = { nodes: ['signals', 'signs', 'crossings', 'nodes'], roads: ['roads', 'roads-bridge'], laneEnds: ['lane-ends'], laneLinks: ['lane-links'] } as const;

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

/** Zone badge with its name drawn in: the style has no glyphs, so labels are images. */
function zoneBadge(name: string): ImageData | null {
  const font = '700 22px "Fira Sans Extra Condensed", "Albert Sans", sans-serif';
  const probe = document.createElement('canvas').getContext('2d');
  if (!probe) return null;
  probe.font = font;
  const h = 36;
  const w = Math.max(h, Math.ceil(probe.measureText(name).width) + 22);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const c = canvas.getContext('2d');
  if (!c) return null;
  c.fillStyle = '#E54489'; c.strokeStyle = '#FBF6EA'; c.lineWidth = 4;
  c.beginPath(); c.roundRect(2, 2, w - 4, h - 4, (h - 4) / 2); c.fill(); c.stroke();
  c.fillStyle = '#FFFFFF'; c.font = font; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(name, w / 2, h / 2 + 1);
  return c.getImageData(0, 0, w, h);
}

function addZoneBadges(map: MapLibreMap): void {
  map.on('styleimagemissing', (e: { id: string }) => {
    if (!e.id.startsWith('zone-') || map.hasImage(e.id)) return;
    const img = zoneBadge(e.id.slice(5));
    if (img) map.addImage(e.id, img, { pixelRatio: 2 });
    // Drawn before the web fonts arrived: redraw once they are in.
    if (document.fonts.status !== 'loaded') {
      void document.fonts.ready.then(() => {
        const again = zoneBadge(e.id.slice(5));
        if (again && map.hasImage(e.id)) { map.removeImage(e.id); map.addImage(e.id, again, { pixelRatio: 2 }); }
      });
    }
  });
}

function setArrowImage(map: MapLibreMap, color: string): void {
  const image = arrowImage(color);
  if (!image) return;
  if (map.hasImage('arrow')) map.updateImage('arrow', image);
  else map.addImage('arrow', image, { pixelRatio: 2 });
}

/**
 * Road width grows with zoom and lane count; from zoom 16 on it is the real width of the
 * carriageway (`w17` px at zoom 17, doubling per step), so the lane lines fall inside it.
 * `extra` px is added for casings and highlights.
 */
const laneWidth = (extra: unknown = 0) => [
  'interpolate', ['exponential', 2], ['zoom'],
  13, ['+', ['*', 0.5, ['get', 'lanes']], extra],
  16, ['+', ['max', ['*', 2, ['get', 'lanes']], ['/', ['get', 'w17'], 2]], extra],
  22, ['+', ['*', 32, ['get', 'w17']], extra],
] as never;

const GRAPH_NODE_KINDS = ['junction', 'end', 'vertex'];
const NODES_FILTER = ['all', ['!=', ['get', 'kind'], 'signal'], ['any', ['in', ['get', 'kind'], ['literal', GRAPH_NODE_KINDS]], ['>=', ['zoom'], 17]]];

const scenes = new WeakMap<MapLibreMap, Scene3dLayer>();

/** The 3D scene layer of a map, once the editor layers are added. */
export const sceneOf = (map: MapLibreMap) => scenes.get(map) ?? null;

const rgb = (hex: string): Rgb => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as unknown as Rgb;

/** Colours of the 3D scene: one flat tone for buildings, bridge decks in their road class colour. */
export function sceneColors(p: MapPalette): Scene3dColors & { selection: Rgb } {
  const byHighway = new Map<string, Rgb>();
  ROAD_CLASSES.forEach((c) => c.match.forEach((h) => byHighway.set(h, rgb(p.roads[c.id]))));
  const service = rgb(p.roads.service);
  return {
    building: rgb(p.building3d), deck: (h) => byHighway.get(h) ?? service,
    deckSide: rgb(p.bridgeSide), pier: rgb(p.bridgeSide), portal: rgb(p.bridgeSide), selection: rgb(p.selection),
  };
}

export function addEditorLayers(map: MapLibreMap, p: MapPalette): void {
  SOURCES.forEach((id) => map.addSource(id, { type: 'geojson', data: EMPTY as never }));
  setArrowImage(map, p.arrow);
  addSignImages(map);
  addZoneBadges(map);

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
  // Lanes close in: thin lines in the colour of their load, links across junctions, lane ends at
  // the junction being edited (red where traffic comes in, blue where it leaves).
  map.addLayer({ id: 'lanes', type: 'line', source: 'lanes', minzoom: 17, layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 17, 1, 19, 2.2], 'line-opacity': 0.95 } });
  map.addLayer({ id: 'lane-links', type: 'line', source: 'lane-links', minzoom: 17, layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['case', ['get', 'picked'], 4, ['get', 'edit'], 2.4, 1.1],
      'line-opacity': ['case', ['get', 'edit'], 0.95, 0.5],
    } });
  map.addLayer({ id: 'lane-ends', type: 'circle', source: 'lane-ends', minzoom: 16,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 16, 4, 19, 8],
      'circle-color': ['case', ['get', 'hot'], ['match', ['get', 'kind'], 'in', '#E5392A', '#3F8BC4'], '#FBF6EA'],
      'circle-stroke-width': 2.5,
      'circle-stroke-color': ['match', ['get', 'kind'], 'in', '#E5392A', '#3F8BC4'],
    } });
  const scene = new Scene3dLayer();
  scenes.set(map, scene);
  map.addLayer(scene);
  map.setLayoutProperty(SCENE3D_LAYER, 'visibility', 'none');
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
  map.addLayer({
    id: 'macro-flow', type: 'line', source: 'macro', filter: ['==', ['get', 'kind'], 'flow'],
    layout: { 'line-cap': 'round' },
    paint: {
      'line-color': ['get', 'color'], 'line-opacity': 0.9,
      'line-width': ['interpolate', ['linear'], ['get', 'v'], 0, 1.5, 500, 4, 2000, 9],
      'line-offset': ['interpolate', ['linear'], ['zoom'], 13, 1.5, 18, 6],
    },
  });
  map.addLayer({
    id: 'transit-line', type: 'line', source: 'transit', filter: ['==', ['get', 'kind'], 'line'], layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['get', 'on'], 5, 2], 'line-opacity': ['case', ['get', 'on'], 0.95, 0.45], 'line-offset': 3 },
  });
  map.addLayer({
    id: 'transit-stop', type: 'circle', source: 'transit', filter: ['==', ['get', 'kind'], 'stop'], minzoom: 13,
    paint: { 'circle-radius': ['case', ['get', 'on'], 5, 3], 'circle-color': '#FBF6EA', 'circle-stroke-color': '#D9502B', 'circle-stroke-width': 2 },
  });
  map.addLayer({ id: 'macro-iso', type: 'circle', source: 'macro', filter: ['==', ['get', 'kind'], 'iso'], paint: { 'circle-color': ['get', 'color'], 'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 3, 18, 8], 'circle-opacity': 0.85 } });
  map.addLayer({
    id: 'macro-zone', type: 'symbol', source: 'macro', filter: ['==', ['get', 'kind'], 'zone'],
    layout: { 'icon-image': ['concat', 'zone-', ['get', 'name']], 'icon-allow-overlap': true, 'icon-ignore-placement': true },
  });
  map.addLayer({ id: 'macro-signal', type: 'circle', source: 'signals', paint: { 'circle-color': ['get', 'color'], 'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 2.5, 18, 6], 'circle-stroke-width': 1.5, 'circle-stroke-color': '#1B110A' } });
  map.addLayer({
    id: 'vehicles', type: 'circle', source: 'vehicles',
    paint: {
      'circle-color': ['get', 'color'], 'circle-stroke-width': 1, 'circle-stroke-color': '#1B110A',
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, ['case', ['get', 'big'], 3, 2], 18, ['case', ['get', 'big'], 8, 5]],
    },
  });
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

const ROAD_LAYERS = ['roads-casing', 'roads', 'roads-bridge', 'roads-arrows', 'selection-line', 'lanes', 'lane-links', 'lane-ends'];

/** Applies the layer toggles from the bottom bar. Bridges and tunnels are filters on the road layers. */
export function applyLayerVisibility(map: MapLibreMap, on: Record<LayerId, boolean>, view3d = false): void {
  const show = (layer: string, visible: boolean) => map.setLayoutProperty(layer, 'visibility', visible ? 'visible' : 'none');
  ROAD_LAYERS.forEach((l) => show(l, on.roads));
  // In 3D the bridges are decks of the scene layer; the flat line stays only for clicks.
  show('roads-bridge', on.roads && on.bridges);
  map.setPaintProperty('roads-bridge', 'line-opacity', view3d ? 0 : 1);
  map.setLayoutProperty(SCENE3D_LAYER, 'visibility', view3d ? 'visible' : 'none');
  sceneOf(map)?.setVisible(on.buildings, on.bridges || on.tunnels);
  // Vertices of the selected way stay visible and draggable even with junctions hidden.
  show('nodes', true);
  map.setFilter('nodes', (on.junctions ? NODES_FILTER : ['==', ['get', 'kind'], 'vertex']) as never);
  show('signals', on.signals);
  show('crossings', on.crossings);
  show('signs', on.signs);
  show('buildings', on.buildings && !view3d);
  show('tram', on.tram);
  show('transit-line', on.transit);
  show('transit-stop', on.transit);
  const structure: unknown[] = ['all'];
  if (!on.bridges || view3d) structure.push(['!', ['get', 'bridge']]);
  if (!on.tunnels) structure.push(['!', ['get', 'tunnel']]);
  map.setFilter('roads-casing', structure as never);
  map.setFilter('roads', ['all', ['!', ['get', 'bridge']], structure] as never);
  map.setFilter('roads-arrows', ['all', ['!=', ['get', 'dir'], 'both'], structure] as never);
  // In 3D bridge and tunnel lanes would lie on the ground under their deck or tube.
  map.setFilter('lanes', (view3d ? ['!', ['get', 'raised']] : null) as never);
}
