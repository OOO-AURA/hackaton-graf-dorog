import type { Map as MapLibreMap } from 'maplibre-gl';
import type { LayerId } from '../state/ui';
import { ROAD_CLASSES, roadColorExpression, type MapPalette } from './palette';
import { Scene3dLayer, SCENE3D_LAYER } from './scene3d';
import type { Rgb, Scene3dColors } from './mesh3d';
import { thematicExpression, type RoadColorMode } from './thematic';

const EMPTY = { type: 'FeatureCollection', features: [] } as const;

export const SOURCES = ['buildings', 'context', 'roads', 'nodes', 'selection', 'issues', 'draw', 'vehicles', 'macro', 'signals', 'transit', 'lanes', 'lane-links', 'lane-ends', 'turns', 'changes', 'route'] as const;
export type SourceId = (typeof SOURCES)[number];

export const HIT_LAYERS = { nodes: ['signals', 'signs', 'crossings', 'nodes'], roads: ['roads', 'roads-bridge'], buildings: ['buildings'], laneEnds: ['lane-ends'], laneLinks: ['lane-links'] } as const;

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

/** Lane lines are shown once the flows give them a load; lane markings always. */
const LANE_LINES = ['all', ['==', ['get', 'kind'], 'lane'], ['==', ['get', 'loaded'], true]];
const DASHED_MARKS = ['all', ['==', ['get', 'kind'], 'divider'], ['!=', ['get', 'solid'], true]];
const SOLID_MARKS = ['all', ['==', ['get', 'kind'], 'divider'], ['==', ['get', 'solid'], true]];
const LANE_MARK_MINZOOM = 16.5;
/** Width of a lane marking in px; the road itself doubles per zoom step, so the marking does too. */
const markWidth = (z16_5: number, z18: number, z20: number) => ['interpolate', ['exponential', 2], ['zoom'], 16.5, z16_5, 18, z18, 20, z20] as never;

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
    deckSide: rgb(p.bridgeSide), parapet: rgb(p.bridgeParapet), mark: rgb(p.laneMark), markCasing: rgb(p.laneMarkCasing), pier: rgb(p.bridgeSide), portal: rgb(p.bridgeSide), selection: rgb(p.selection),
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
  // A blurred copy shifted down-right reads as the deck standing above the ground.
  map.addLayer({
    id: 'bridge-shadow', type: 'line', source: 'roads', filter: ['get', 'bridge'], layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: { 'line-width': laneWidth(4), 'line-blur': ['interpolate', ['linear'], ['zoom'], 14, 2, 18, 8], 'line-translate': [4, 5], 'line-translate-anchor': 'viewport' },
  }, 'roads-casing');
  map.addLayer({ id: 'roads-bridge', type: 'line', source: 'roads', filter: ['get', 'bridge'], layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-width': laneWidth() } });
  map.addLayer({ id: 'selection-line', type: 'line', source: 'selection', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 13, 6, 18, 26], 'line-opacity': 0.55 } }, 'roads-casing');
  map.addLayer({
    id: 'roads-arrows', type: 'symbol', source: 'roads', filter: ['!=', ['get', 'dir'], 'both'], minzoom: 15,
    layout: { 'symbol-placement': 'line', 'symbol-spacing': 60, 'icon-image': 'arrow', 'icon-allow-overlap': true, 'icon-rotate': ['case', ['==', ['get', 'dir'], 'backward'], 180, 0] },
  });
  // Lanes close in: thin lines in the colour of their load, links across junctions, lane ends at
  // the junction being edited (red where traffic comes in, blue where it leaves).
  map.addLayer({ id: 'lanes', type: 'line', source: 'lanes', minzoom: 17, filter: LANE_LINES as never, layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 17, 1, 19, 2.2], 'line-opacity': 0.95 } });
  // Lane markings: a dark outline under a light line, so they read on any road colour and theme;
  // solid between the two directions, dashed between lanes going the same way.
  map.addLayer({ id: 'lane-marks-casing', type: 'line', source: 'lanes', minzoom: LANE_MARK_MINZOOM, filter: ['==', ['get', 'kind'], 'divider'],
    layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-width': markWidth(1.8, 3.2, 8), 'line-opacity': 0.55 } });
  map.addLayer({ id: 'lane-marks-dash', type: 'line', source: 'lanes', minzoom: LANE_MARK_MINZOOM, filter: DASHED_MARKS as never,
    layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-width': markWidth(0.7, 1.3, 3.5), 'line-dasharray': [3, 3] } });
  map.addLayer({ id: 'lane-marks-solid', type: 'line', source: 'lanes', minzoom: LANE_MARK_MINZOOM, filter: SOLID_MARKS as never,
    layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-width': markWidth(0.8, 1.5, 4) } });
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
  // Junctions with turn bans: a dashed-looking double ring around the node.
  map.addLayer({ id: 'turn-bans', type: 'circle', source: 'turns', minzoom: 14, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 6, 18, 13], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': 2.5, 'circle-stroke-opacity': 0.9 } });
  // What changed against the opened file: new green, edited orange, removed red dashed.
  const changeColor = ['match', ['get', 'kind'], 'added', '#2E9E4F', 'deleted', '#D92D20', '#E07B12'];
  map.addLayer({ id: 'changes-line', type: 'line', source: 'changes', filter: ['==', ['geometry-type'], 'LineString'], layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': changeColor as never, 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 4, 18, 14], 'line-opacity': 0.55 } });
  map.addLayer({ id: 'changes-point', type: 'circle', source: 'changes', filter: ['==', ['geometry-type'], 'Point'], layout: { visibility: 'none' },
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 5, 18, 12], 'circle-color': changeColor as never, 'circle-opacity': 0.6 } });
  map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#7A4FA0', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 4, 18, 10], 'line-opacity': 0.85 } });
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
    id: 'macro-bundle', type: 'line', source: 'macro', filter: ['==', ['get', 'kind'], 'bundle'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['case', ['get', 'own'], '#E54489', '#EE5C9C'], 'line-opacity': ['case', ['get', 'own'], 1, 0.8],
      'line-width': ['interpolate', ['linear'], ['get', 'share'], 0, 2, 1, 14],
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
  set('bridge-shadow', 'line-color', p.bridgeShadow);
  set('lane-marks-casing', 'line-color', p.laneMarkCasing);
  set('lane-marks-dash', 'line-color', p.laneMark);
  set('lane-marks-solid', 'line-color', p.laneMark);
  set('selection-line', 'line-color', p.selection);
  set('nodes', 'circle-color', ['match', ['get', 'kind'], 'end', p.roads.secondary, 'vertex', p.vertex, p.nodeFill]);
  set('nodes', 'circle-stroke-color', p.nodeStroke);
  set('signals', 'circle-color', p.signal);
  set('signals', 'circle-stroke-color', p.nodeStroke);
  set('selection-node', 'circle-stroke-color', p.selection);
  set('turn-bans', 'circle-stroke-color', p.error);
  set('issues-halo', 'circle-color', issueColor);
  set('issues', 'circle-stroke-color', issueColor);
  set('draw-line', 'line-color', p.draw);
  set('draw-points', 'circle-color', p.nodeFill);
  set('draw-points', 'circle-stroke-color', p.draw);
}

/** Road colour by class or by one attribute; bridges keep the same colour as the road they carry. */
export function applyRoadColors(map: MapLibreMap, p: MapPalette, mode: RoadColorMode): void {
  const color = mode === 'class' ? roadColorExpression(p) : thematicExpression(mode);
  map.setPaintProperty('roads', 'line-color', color as never);
  map.setPaintProperty('roads-bridge', 'line-color', color as never);
}

const ROAD_LAYERS = ['roads-casing', 'roads', 'roads-bridge', 'roads-arrows', 'selection-line', 'lanes', 'lane-marks-casing', 'lane-marks-dash', 'lane-marks-solid', 'lane-links', 'lane-ends'];

/** Applies the layer toggles from the bottom bar. Bridges and tunnels are filters on the road layers. */
export function applyLayerVisibility(map: MapLibreMap, on: Record<LayerId, boolean>, view3d = false): void {
  const show = (layer: string, visible: boolean) => map.setLayoutProperty(layer, 'visibility', visible ? 'visible' : 'none');
  ROAD_LAYERS.forEach((l) => show(l, on.roads));
  // In 3D the bridges are decks of the scene layer; the flat line stays only for clicks.
  show('roads-bridge', on.roads && on.bridges);
  map.setPaintProperty('roads-bridge', 'line-opacity', view3d ? 0 : 1);
  map.setLayoutProperty(SCENE3D_LAYER, 'visibility', view3d ? 'visible' : 'none');
  sceneOf(map)?.setVisible(on.buildings, on.bridges || on.tunnels);
  show('bridge-shadow', on.roads && on.bridges && !view3d);
  // Vertices of the selected way stay visible and draggable even with junctions hidden.
  show('nodes', true);
  map.setFilter('nodes', (on.junctions ? NODES_FILTER : ['==', ['get', 'kind'], 'vertex']) as never);
  show('signals', on.signals);
  show('crossings', on.crossings);
  show('signs', on.signs);
  show('buildings', on.buildings && !view3d);
  show('tram', on.tram);
  show('changes-line', on.changes);
  show('changes-point', on.changes);
  show('transit-line', on.transit);
  show('transit-stop', on.transit);
  const structure: unknown[] = ['all'];
  if (!on.bridges || view3d) structure.push(['!', ['get', 'bridge']]);
  if (!on.tunnels) structure.push(['!', ['get', 'tunnel']]);
  map.setFilter('roads-casing', structure as never);
  map.setFilter('roads', ['all', ['!', ['get', 'bridge']], structure] as never);
  map.setFilter('roads-arrows', ['all', ['!=', ['get', 'dir'], 'both'], structure] as never);
  // In 3D bridge and tunnel lanes would lie on the ground under their deck or tube; the deck
  // carries its own markings (mesh3d.ts).
  const flat = (filter: unknown[]) => (view3d ? ['all', filter, ['!=', ['get', 'raised'], true]] : filter) as never;
  map.setFilter('lanes', flat(LANE_LINES));
  map.setFilter('lane-marks-casing', flat(['==', ['get', 'kind'], 'divider']));
  map.setFilter('lane-marks-dash', flat(DASHED_MARKS));
  map.setFilter('lane-marks-solid', flat(SOLID_MARKS));
}
