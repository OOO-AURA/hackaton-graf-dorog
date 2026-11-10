import { signBitmap } from './signArt';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { LayerId } from '../state/ui';
import { ROAD_CLASSES, roadColorExpression, type MapPalette } from './palette';
import { Scene3dLayer, SCENE3D_LAYER } from './scene3d';
import { addRailLines, addStationLayers, applyRailPalette, RAIL_HIT_LINES, RAIL_HIT_POINTS, RAIL_LAYERS, RAIL_SOURCES } from './railLayers';
import { addJunctionLayers, JUNCTION_LAYERS, JUNCTION_SOURCES, SIGN_LAYER, UNDER_DECK_LAYERS } from './junctionLayers';
import type { Rgb, Scene3dColors } from './mesh3d';
import { thematicExpression, type RoadColorMode } from './thematic';
import { VEHICLE_MIN_ZOOM } from './props3d';
import type { RoadLook } from '../state/ui';

const EMPTY = { type: 'FeatureCollection', features: [] } as const;

export const SOURCES = ['buildings', 'context', 'roads', 'nodes', 'selection', 'issues', 'draw', 'vehicles', 'vehicle-shapes', 'macro', 'signals', 'transit', 'lanes', 'lane-links', 'lane-ends', ...JUNCTION_SOURCES, ...RAIL_SOURCES, 'draw-conflicts', 'sidewalks', 'issue-ways', 'turns', 'changes', 'route', 'ghost', 'building-handles'] as const;
export type SourceId = (typeof SOURCES)[number];

export const HIT_LAYERS = { nodes: ['signals', 'signs', 'crossings', 'nodes', ...RAIL_HIT_POINTS], roads: ['roads', 'roads-bridge', ...RAIL_HIT_LINES], buildings: ['buildings'], laneEnds: ['lane-ends'], laneLinks: ['lane-links', 'lane-ribbons'] } as const;

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

/** Small sign icons for nodes (crossing, bus stop, bump), from the shared SVG art (signArt.ts). */
function addSignImages(map: MapLibreMap): void {
  ['crossing', 'bus_stop', 'bump', 'signal', 'tram_stop'].forEach((name) => {
    void signBitmap(name, 40).then((img) => {
      if (img && !map.hasImage(`sign-${name}`)) map.addImage(`sign-${name}`, img, { pixelRatio: 2 });
    });
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

/**
 * Sideways shift of a road line in px: a two-way road with more lanes one way lies off-centre
 * (`o17` px to the right at zoom 17), so its lanes fall inside it. None while roads are drawn thin.
 */
const roadOffset = ['interpolate', ['exponential', 2], ['zoom'], 15, 0, 16, ['/', ['get', 'o17'], 2], 22, ['*', 32, ['get', 'o17']]] as never;

/** Lane lines are shown once the flows give them a load; lane markings always. */
const LANE_LINES = ['all', ['==', ['get', 'kind'], 'lane'], ['==', ['get', 'loaded'], true]];
const DASHED_MARKS = ['all', ['==', ['get', 'kind'], 'divider'], ['!=', ['get', 'solid'], true]];
const SOLID_MARKS = ['all', ['==', ['get', 'kind'], 'divider'], ['==', ['get', 'solid'], true]];
const BUS_LANES = ['all', ['==', ['get', 'kind'], 'lane'], ['==', ['get', 'psv'], true]];

/** The letter A painted on lanes for route vehicles (marking 1.23.1): white, a dark edge to read on any colour. */
function addBusLaneImage(map: MapLibreMap): void {
  if (map.hasImage('bus-lane-a')) return;
  const size = 80;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.font = 'bold 64px Arial, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(20, 16, 12, 0.6)';
  ctx.strokeText('A', size / 2, size / 2 + 4);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText('A', size / 2, size / 2 + 4);
  map.addImage('bus-lane-a', ctx.getImageData(0, 0, size, size), { pixelRatio: 2 });
}
const LANE_MARK_MINZOOM = 16.5;
/** Width of a lane marking in px; the road itself doubles per zoom step, so the marking does too. */
const markWidth = (z16_5: number, z18: number, z20: number) => ['interpolate', ['exponential', 2], ['zoom'], 16.5, z16_5, 18, z18, 20, z20] as never;

/** Width of the road being drawn: its real width close in (w17 px at zoom 17), at least a few px. */
const drawWidthExpr = (extra: number) => ['interpolate', ['exponential', 2], ['zoom'],
  13, ['+', ['max', 3, ['/', ['get', 'w17'], 16]], extra], 17, ['+', ['max', 4, ['get', 'w17']], extra], 22, ['+', ['*', 32, ['get', 'w17']], extra]] as never;

const GRAPH_NODE_KINDS = ['junction', 'end', 'vertex'];
const NODES_FILTER = ['all', ['!=', ['get', 'kind'], 'signal'], ['any', ['in', ['get', 'kind'], ['literal', GRAPH_NODE_KINDS]], ['>=', ['zoom'], 17]]];

const scenes = new WeakMap<MapLibreMap, Scene3dLayer>();

/** The 3D scene layer of a map, once the editor layers are added. */
export const sceneOf = (map: MapLibreMap) => scenes.get(map) ?? null;

const rgb = (hex: string): Rgb => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as unknown as Rgb;

/** Colours of the 3D scene: one flat tone for buildings, bridge decks like the roads (class colour or asphalt). */
export function sceneColors(p: MapPalette, look: RoadLook = 'graph'): Scene3dColors & { selection: Rgb } {
  const byHighway = new Map<string, Rgb>();
  ROAD_CLASSES.forEach((c) => c.match.forEach((h) => byHighway.set(h, rgb(p.roads[c.id]))));
  const service = rgb(p.roads.service);
  const asphalt = rgb(p.asphalt);
  return {
    building: rgb(p.building3d), deck: (h) => (look === 'engineering' ? asphalt : byHighway.get(h) ?? service),
    deckSide: rgb(p.bridgeSide), parapet: rgb(p.bridgeParapet), embankment: rgb(p.embankment), mark: rgb(p.laneMark), markCasing: rgb(p.laneMarkCasing), pier: rgb(p.bridgeSide), portal: rgb(p.bridgeSide), selection: rgb(p.selection),
  };
}

export function addEditorLayers(map: MapLibreMap, p: MapPalette): void {
  SOURCES.forEach((id) => map.addSource(id, { type: 'geojson', data: EMPTY as never }));
  setArrowImage(map, p.arrow);
  addSignImages(map);
  addZoneBadges(map);

  map.addLayer({ id: 'buildings', type: 'fill', source: 'buildings', paint: { 'fill-opacity': 0.55 } });
  // Footpaths at their real width from zoom 16: walks, pedestrian streets, cycleways, steps, trails.
  const metres = (m: unknown, extra = 0) => ['interpolate', ['exponential', 2], ['zoom'], 13, 0.6 + extra, 16, ['+', ['max', 1.2, ['*', m, 0.68]], extra], 22, ['+', ['*', m, 0.68 * 64], extra]] as never;
  const pathW = ['match', ['get', 'path'], 'square', 8, 'cycle', 2, 'steps', 2.5, 'walk', 2.25, 1.4];
  const isPath = ['==', ['get', 'kind'], 'path'];
  map.addLayer({ id: 'context-casing', type: 'line', source: 'context', filter: isPath as never, minzoom: 15, layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-width': metres(pathW, 1.5), 'line-color': '#000', 'line-opacity': 0.25 } });
  map.addLayer({ id: 'context', type: 'line', source: 'context', filter: ['!=', ['get', 'kind'], 'rail'], layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-width': metres(pathW) } });
  map.addLayer({ id: 'context-steps', type: 'line', source: 'context', filter: ['==', ['get', 'path'], 'steps'] as never, minzoom: 17,
    paint: { 'line-width': metres(2.5), 'line-color': '#000', 'line-opacity': 0.35, 'line-dasharray': [0.25, 0.35] } });
  // Sidewalks along streets, beside the carriageway on each side that has one.
  const sideOffset = (prop: string) => ['interpolate', ['exponential', 2], ['zoom'], 15, ['/', ['get', prop], 4], 22, ['*', 32, ['get', prop]]] as never;
  const sideWidth = ['interpolate', ['exponential', 2], ['zoom'], 15, ['/', ['get', 's17'], 4], 22, ['*', 32, ['get', 's17']]] as never;
  // Pieces of a street meeting end to end are one line here (map/sidewalks.ts), so bends are round.
  map.addLayer({ id: 'sidewalk-left', type: 'line', source: 'sidewalks', minzoom: 15, filter: ['in', 'l', ['get', 'sw']] as never,
    layout: { 'line-join': 'round', 'line-cap': 'butt' }, paint: { 'line-width': sideWidth, 'line-offset': sideOffset('sl17') } });
  map.addLayer({ id: 'sidewalk-right', type: 'line', source: 'sidewalks', minzoom: 15, filter: ['in', 'r', ['get', 'sw']] as never,
    layout: { 'line-join': 'round', 'line-cap': 'butt' }, paint: { 'line-width': sideWidth, 'line-offset': sideOffset('sr17') } });
  addRailLines(map);
  map.addLayer({ id: 'roads-casing', type: 'line', source: 'roads', filter: ['!', ['get', 'bridge']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': laneWidth(2), 'line-offset': roadOffset } });
  // Bridge outlines end square with the deck, not in a half-disc over the road it lands on.
  map.addLayer({ id: 'bridge-casing', type: 'line', source: 'roads', filter: ['get', 'bridge'], layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-width': laneWidth(5), 'line-offset': roadOffset } });
  map.addLayer({
    id: 'roads', type: 'line', source: 'roads', filter: ['!', ['get', 'bridge']], layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-width': laneWidth(), 'line-offset': roadOffset, 'line-opacity': ['case', ['get', 'tunnel'], 0.45, 1] },
  });
  // A blurred copy shifted down-right reads as the deck standing above the ground.
  map.addLayer({
    id: 'bridge-shadow', type: 'line', source: 'roads', filter: ['get', 'bridge'], layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: { 'line-width': laneWidth(4), 'line-offset': roadOffset, 'line-blur': ['interpolate', ['linear'], ['zoom'], 14, 2, 18, 8], 'line-translate': [4, 5], 'line-translate-anchor': 'viewport' },
  }, 'roads-casing');
  map.addLayer({ id: 'roads-bridge', type: 'line', source: 'roads', filter: ['get', 'bridge'], layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-width': laneWidth(), 'line-offset': roadOffset } });
  map.addLayer({ id: 'selection-line', type: 'line', source: 'selection', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 13, 6, 18, 26], 'line-opacity': 0.55 } }, 'roads-casing');
  map.addLayer({
    id: 'roads-arrows', type: 'symbol', source: 'roads', filter: ['all', ['!=', ['get', 'dir'], 'both'], ['!', ['get', 'taper']]], minzoom: 15,
    layout: { 'symbol-placement': 'line', 'symbol-spacing': 60, 'icon-image': 'arrow', 'icon-allow-overlap': true, 'icon-rotate': ['case', ['==', ['get', 'dir'], 'backward'], 180, 0] },
  });
  // Lanes close in: thin lines in the colour of their load, links across junctions, lane ends at
  // the junction being edited (red where traffic comes in, blue where it leaves).
  map.addLayer({ id: 'lanes', type: 'line', source: 'lanes', minzoom: 17, filter: LANE_LINES as never, layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 17, 1, 19, 2.2], 'line-opacity': 0.95 } });
  // Lane markings: a dark outline under a light line, so they read on any road colour and theme;
  // solid between the two directions, dashed between lanes going the same way.
  // Lanes for route vehicles and taxis: a terracotta band with the letter A (marking 1.23.1) along it.
  addBusLaneImage(map);
  map.addLayer({ id: 'bus-lanes', type: 'line', source: 'lanes', minzoom: 15, filter: BUS_LANES as never, layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: { 'line-color': '#B4513F', 'line-opacity': 0.55, 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 15, ['/', ['get', 'w17'], 4], 22, ['*', 32, ['get', 'w17']]] as never } });
  map.addLayer({ id: 'bus-lane-letters', type: 'symbol', source: 'lanes', minzoom: 17, filter: BUS_LANES as never,
    layout: {
      'symbol-placement': 'line', 'symbol-spacing': 140, 'icon-image': 'bus-lane-a', 'icon-allow-overlap': true,
      'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map', 'icon-rotate': ['case', ['get', 'rev'], -90, 90],
      'icon-size': ['interpolate', ['exponential', 2], ['zoom'], 17, ['/', ['get', 'w17'], 40], 22, ['/', ['*', 32, ['get', 'w17']], 40]] as never,
    } });
  map.addLayer({ id: 'lane-marks-casing', type: 'line', source: 'lanes', minzoom: LANE_MARK_MINZOOM, filter: ['==', ['get', 'kind'], 'divider'],
    layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-width': markWidth(1.8, 3.2, 8), 'line-opacity': 0.55 } });
  map.addLayer({ id: 'lane-marks-dash', type: 'line', source: 'lanes', minzoom: LANE_MARK_MINZOOM, filter: DASHED_MARKS as never,
    layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-width': markWidth(0.7, 1.3, 3.5), 'line-dasharray': [3, 3] } });
  map.addLayer({ id: 'lane-marks-solid', type: 'line', source: 'lanes', minzoom: LANE_MARK_MINZOOM, filter: SOLID_MARKS as never,
    layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-width': markWidth(0.8, 1.5, 4) } });
  addJunctionLayers(map);
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
  map.addLayer({ id: 'signs', type: 'symbol', source: 'nodes', minzoom: 14, filter: ['in', ['get', 'symbol'], ['literal', ['bump', 'bus_stop']]], layout: signLayout(1) });
  addStationLayers(map);
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
  // The selected road is tinted on top of its surface too, so it shows on asphalt and in any colour.
  map.addLayer({ id: 'selection-tint', type: 'line', source: 'selection', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 13, 4, 18, 18, 21, 120], 'line-opacity': 0.32 } });
  map.addLayer({ id: 'selection-edge', type: 'line', source: 'selection', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-width': 2, 'line-dasharray': [2, 1.5] } });
  // Roads an issue is about: a red or orange glow under them, like the issue marker.
  map.addLayer({ id: 'issue-ways', type: 'line', source: 'issue-ways', layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 13, 6, 18, 30], 'line-opacity': ['case', ['get', 'focused'], 0.7, 0.4], 'line-blur': 3 } }, 'roads-casing');
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
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, ['interpolate', ['linear'], ['get', 'v'], 0, 1, 500, 2.5, 2000, 5], 18, ['interpolate', ['linear'], ['get', 'v'], 0, 3, 500, 8, 2000, 18]],
      'line-offset': ['interpolate', ['linear'], ['zoom'], 13, 1.5, 18, 8],
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
  // Close up a vehicle is its real outline from above (2D) or a model (3D, scene3d.ts); further out a dot.
  map.addLayer({ id: 'vehicle-shapes', type: 'fill', source: 'vehicle-shapes', minzoom: VEHICLE_MIN_ZOOM, paint: { 'fill-color': ['get', 'color'], 'fill-outline-color': '#1B110A' } });
  map.addLayer({
    id: 'vehicles', type: 'circle', source: 'vehicles', maxzoom: VEHICLE_MIN_ZOOM,
    paint: {
      'circle-color': ['get', 'color'], 'circle-stroke-width': 1, 'circle-stroke-color': '#1B110A',
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, ['case', ['get', 'big'], 3, 2], 16, ['case', ['get', 'big'], 6, 4]],
    },
  });
  // The building tool's ghost: the footprint raised to the height the building will get, see-through.
  map.addLayer({ id: 'ghost-3d', type: 'fill-extrusion', source: 'ghost',
    paint: { 'fill-extrusion-color': ['case', ['get', 'warn'], '#E5392A', '#E54489'], 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-opacity': 0.55 } });
  map.addLayer({ id: 'ghost-line', type: 'line', source: 'ghost',
    paint: { 'line-color': ['case', ['get', 'warn'], '#E5392A', '#E54489'], 'line-width': 2, 'line-dasharray': [2, 1.5] } });
  // Handles of the selected building (map/useBuildingEditing.ts); the sides only catch the mouse.
  const kind = (k: string) => ['==', ['get', 'kind'], k] as never;
  map.addLayer({ id: 'bh-edge', type: 'line', source: 'building-handles', filter: kind('edge'), paint: { 'line-width': 14, 'line-opacity': 0.01, 'line-color': '#E54489' } });
  map.addLayer({ id: 'bh-rotate-line', type: 'line', source: 'building-handles', filter: kind('rotate-line'), paint: { 'line-color': '#E54489', 'line-width': 1.5, 'line-dasharray': [2, 2] } });
  map.addLayer({ id: 'bh-mid', type: 'circle', source: 'building-handles', filter: kind('mid'),
    paint: { 'circle-radius': 4, 'circle-color': '#FBF6EA', 'circle-opacity': 0.85, 'circle-stroke-color': '#E54489', 'circle-stroke-width': 1.5 } });
  map.addLayer({ id: 'bh-corner', type: 'circle', source: 'building-handles', filter: kind('corner'),
    paint: { 'circle-radius': 6, 'circle-color': ['case', ['get', 'picked'], '#E54489', '#FBF6EA'], 'circle-stroke-color': '#E54489', 'circle-stroke-width': 2.5 } });
  map.addLayer({ id: 'bh-rotate', type: 'circle', source: 'building-handles', filter: kind('rotate'),
    paint: { 'circle-radius': 7, 'circle-color': '#E54489', 'circle-stroke-color': '#FBF6EA', 'circle-stroke-width': 2 } });
  // The road being drawn looks like the road it will be: its width, an edge line and a dashed
  // centre line; it turns red over buildings in its way, and those buildings turn red too.
  map.addLayer({ id: 'draw-conflict-fill', type: 'fill', source: 'draw-conflicts', paint: { 'fill-color': '#E5392A', 'fill-opacity': 0.45 } });
  map.addLayer({ id: 'draw-conflict-line', type: 'line', source: 'draw-conflicts', paint: { 'line-color': '#E5392A', 'line-width': 2 } });
  const ROAD_LINE = ['all', ['==', ['geometry-type'], 'LineString'], ['!', ['has', 'handle']]];
  map.addLayer({ id: 'draw-handle', type: 'line', source: 'draw', filter: ['has', 'handle'], paint: { 'line-color': '#F2A33A', 'line-width': 1.5, 'line-dasharray': [2, 2] } });
  map.addLayer({ id: 'draw-road-edge', type: 'line', source: 'draw', filter: ROAD_LINE as never, layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-width': drawWidthExpr(3), 'line-opacity': 0.9 } });
  map.addLayer({ id: 'draw-road', type: 'line', source: 'draw', filter: ROAD_LINE as never, layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-width': drawWidthExpr(0), 'line-opacity': 0.85 } });
  map.addLayer({ id: 'draw-line', type: 'line', source: 'draw', filter: ROAD_LINE as never, paint: { 'line-width': 1.5, 'line-dasharray': [3, 3] } });
  map.addLayer({ id: 'draw-points', type: 'circle', source: 'draw', filter: ['all', ['==', ['geometry-type'], 'Point'], ['!', ['has', 'marker']]], paint: { 'circle-radius': 5, 'circle-stroke-width': 2 } });
  // The magnet: a ring on the node or road the next point joins, a dot on a round angle, a square
  // handle for the bend of a curve.
  map.addLayer({ id: 'draw-snap', type: 'circle', source: 'draw', filter: ['has', 'marker'],
    paint: {
      'circle-radius': ['match', ['get', 'marker'], 'node', 11, 'way', 8, 'control', 6, 'angle', 5, 4],
      'circle-color': ['match', ['get', 'marker'], 'control', '#F2A33A', 'rgba(0,0,0,0)'],
      'circle-stroke-width': ['match', ['get', 'marker'], 'free', 1.5, 2.5],
      'circle-stroke-color': ['match', ['get', 'marker'], 'node', '#2CC7C9', 'way', '#4C8DF6', 'angle', '#F2A33A', 'control', '#FFFFFF', '#FFFFFF'],
    } });
  applyPalette(map, p);
}

/** Colours every editor layer for the current theme; called on load and on theme change. */
export function applyPalette(map: MapLibreMap, p: MapPalette): void {
  const set = (layer: string, prop: string, value: unknown) => map.setPaintProperty(layer, prop as never, value as never);
  const issueColor = ['case', ['==', ['get', 'kind'], 'cordon'], p.cordon, ['==', ['get', 'severity'], 'error'], p.error, p.warning];
  setArrowImage(map, p.arrow);
  set('buildings', 'fill-color', p.building);
  set('buildings', 'fill-outline-color', p.buildingLine);
  set('context', 'line-color', ['match', ['get', 'path'], 'cycle', p.cycle, 'square', p.square, 'trail', p.trail, p.walk] as never);
  set('sidewalk-left', 'line-color', p.walk);
  set('sidewalk-right', 'line-color', p.walk);
  applyRailPalette(map, p);
  set('roads-casing', 'line-color', p.casing);
  set('bridge-casing', 'line-color', p.bridgeCasing);
  set('roads', 'line-color', roadColorExpression(p));
  set('roads-bridge', 'line-color', roadColorExpression(p));
  set('bridge-shadow', 'line-color', p.bridgeShadow);
  set('lane-marks-casing', 'line-color', p.laneMarkCasing);
  set('lane-marks-dash', 'line-color', p.laneMark);
  set('lane-marks-solid', 'line-color', p.laneMark);
  set('selection-line', 'line-color', p.selection);
  set('selection-tint', 'line-color', p.selection);
  set('selection-edge', 'line-color', p.selection);
  set('issue-ways', 'line-color', ['case', ['==', ['get', 'severity'], 'error'], p.error, p.warning]);
  set('nodes', 'circle-color', ['match', ['get', 'kind'], 'end', p.roads.secondary, 'vertex', p.vertex, p.nodeFill]);
  set('nodes', 'circle-stroke-color', p.nodeStroke);
  set('signals', 'circle-color', p.signal);
  set('signals', 'circle-stroke-color', p.nodeStroke);
  set('selection-node', 'circle-stroke-color', p.selection);
  set('turn-bans', 'circle-stroke-color', p.error);
  set('issues-halo', 'circle-color', issueColor);
  set('issues', 'circle-stroke-color', issueColor);
  set('draw-line', 'line-color', '#FFFFFF');
  set('draw-road', 'line-color', ['case', ['get', 'conflict'], '#B3261E', ['get', 'rail'], p.rail, p.asphalt]);
  set('draw-road-edge', 'line-color', ['case', ['get', 'conflict'], '#FF6B5E', p.draw]);
  set('draw-points', 'circle-color', p.nodeFill);
  set('draw-points', 'circle-stroke-color', p.draw);
}

/** Road colour by class or by one attribute; bridges keep the same colour as the road they carry. */
export function applyRoadColors(map: MapLibreMap, p: MapPalette, mode: RoadColorMode, look: RoadLook = 'graph'): void {
  // An attribute colouring wins over the look: it is asked for on purpose.
  const asphalt = mode === 'class' && look === 'engineering';
  const color = mode !== 'class' ? thematicExpression(mode) : asphalt ? p.asphalt : roadColorExpression(p);
  map.setPaintProperty('roads', 'line-color', color as never);
  map.setPaintProperty('roads-bridge', 'line-color', color as never);
  // On asphalt the casing is the edge line of the carriageway.
  map.setPaintProperty('roads-casing', 'line-color', (asphalt ? p.asphaltEdge : p.casing) as never);
  // On a plan the arrows painted on the lanes show the direction; the graph arrows would clutter it.
  map.setPaintProperty('roads-arrows', 'icon-opacity', 1);
}

const ROAD_LAYERS = ['roads-casing', 'bridge-casing', 'roads', 'roads-bridge', 'roads-arrows', 'selection-line', 'lanes', 'bus-lanes', 'bus-lane-letters', 'lane-marks-casing', 'lane-marks-dash', 'lane-marks-solid', ...JUNCTION_LAYERS];

/** Applies the layer toggles from the bottom bar. Bridges and tunnels are filters on the road layers. */
export function applyLayerVisibility(map: MapLibreMap, on: Record<LayerId, boolean>, view3d = false): void {
  const show = (layer: string, visible: boolean) => map.setLayoutProperty(layer, 'visibility', visible ? 'visible' : 'none');
  ROAD_LAYERS.forEach((l) => show(l, on.roads));
  ['sidewalk-left', 'sidewalk-right', 'context', 'context-casing', 'context-steps'].forEach((l) => show(l, on.sidewalks));
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
  RAIL_LAYERS.forEach((l) => show(l, on.tram));
  show('changes-line', on.changes);
  show('changes-point', on.changes);
  show('transit-line', on.transit);
  show('transit-stop', on.transit);
  const structure: unknown[] = ['all'];
  if (!on.bridges || view3d) structure.push(['!', ['get', 'bridge']]);
  if (!on.tunnels) structure.push(['!', ['get', 'tunnel']]);
  map.setFilter('roads-casing', ['all', ['!', ['get', 'bridge']], structure] as never);
  map.setFilter('bridge-casing', ['all', ['get', 'bridge'], structure] as never);
  map.setFilter('roads', ['all', ['!', ['get', 'bridge']], structure] as never);
  map.setFilter('roads-arrows', ['all', ['!=', ['get', 'dir'], 'both'], ['!', ['get', 'taper']], structure] as never);
  // In 3D bridge and tunnel lanes would lie on the ground under their deck or tube; the deck
  // carries its own markings (mesh3d.ts).
  const flat = (filter: unknown[]) => (view3d ? ['all', filter, ['!=', ['get', 'raised'], true]] : filter) as never;
  map.setFilter('lanes', flat(LANE_LINES));
  map.setFilter('bus-lanes', flat(BUS_LANES));
  map.setFilter('bus-lane-letters', flat(BUS_LANES));
  map.setFilter('lane-marks-casing', flat(['==', ['get', 'kind'], 'divider']));
  map.setFilter('lane-marks-dash', flat(DASHED_MARKS));
  map.setFilter('lane-marks-solid', flat(SOLID_MARKS));
  Object.entries(UNDER_DECK_LAYERS).forEach(([id, base]) => {
    const ground = ['!=', ['get', 'raised'], true];
    map.setFilter(id, (view3d ? (base ? ['all', base, ground] : ground) : base) as never);
  });
  show(SIGN_LAYER, on.signs && !view3d);
  show('vehicle-shapes', !view3d);
}
