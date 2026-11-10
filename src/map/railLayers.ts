import type { Map as MapLibreMap } from 'maplibre-gl';
import type { MapPalette } from './palette';

/**
 * Railway layers: tracks drawn the way rail maps do (a dark line with light ties for railways,
 * a thinner coloured line for trams, sidings thinner still), platforms as light bands, and
 * stations as a symbol with the name next to it. The base style has no fonts, so names are
 * drawn as images, once per name.
 */

export const RAIL_SOURCES = ['rails', 'stations'] as const;
export const RAIL_LAYERS = ['rail-platform', 'rail-base', 'rail-ties', 'rail-metro', 'rail-metro-tunnel', 'stations', 'station-names'] as const;
/** Layers that take clicks: tracks and platforms like roads, stations like nodes. */
export const RAIL_HIT_LINES = ['rail-base', 'rail-metro', 'rail-metro-tunnel', 'rail-platform'] as const;
export const RAIL_HIT_POINTS = ['stations'] as const;

const IS_TRAM = ['in', ['get', 'kind'], ['literal', ['tram', 'light_rail']]];
const IS_SIDE = ['!=', ['get', 'service'], ''];
const IS_PLATFORM = ['==', ['get', 'kind'], 'platform'];
const IS_METRO = ['==', ['get', 'kind'], 'subway'];
const IS_TRACK = ['all', ['!=', ['get', 'kind'], 'platform'], ['!', IS_METRO]];

const zoomWidth = (z13: unknown, z18: unknown) => ['interpolate', ['linear'], ['zoom'], 13, z13, 18, z18] as never;

const NAME_PREFIX = 'station-name:';
const ICON_SIZE = 28;

function nameImage(name: string, dark: boolean): ImageData | null {
  const ratio = 2;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const font = '600 12px "Albert Sans", system-ui, sans-serif';
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(name).width) + 12;
  canvas.width = w * ratio;
  canvas.height = 20 * ratio;
  ctx.scale(ratio, ratio);
  ctx.font = font;
  ctx.fillStyle = dark ? 'rgba(23, 23, 26, 0.85)' : 'rgba(251, 246, 234, 0.92)';
  ctx.beginPath();
  ctx.roundRect(0, 0, w, 20, 5);
  ctx.fill();
  ctx.fillStyle = dark ? '#F1E6CB' : '#3A2516';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 6, 10.5);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function stationIcon(kind: 'station' | 'halt' | 'tram_stop' | 'subway' | 'subway_entrance'): ImageData | null {
  const ratio = 2;
  const canvas = document.createElement('canvas');
  canvas.width = ICON_SIZE * ratio;
  canvas.height = ICON_SIZE * ratio;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(ratio, ratio);
  const c = ICON_SIZE / 2;
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#FFFFFF';
  if (kind === 'subway' || kind === 'subway_entrance') {
    // The metro «М»: a red disc for a station, a smaller rounded square for an entrance.
    ctx.fillStyle = '#D7261E';
    ctx.beginPath();
    if (kind === 'subway') ctx.arc(c, c, 10.5, 0, Math.PI * 2); else ctx.roundRect(c - 7.5, c - 7.5, 15, 15, 3);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold ${kind === 'subway' ? 13 : 10}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('М', c, c + 1);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }
  if (kind === 'tram_stop') {
    ctx.fillStyle = '#7A4FA0';
    ctx.beginPath(); ctx.arc(c, c, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  } else {
    const r = kind === 'station' ? 10 : 7.5;
    ctx.fillStyle = kind === 'station' ? '#C62828' : '#E35B4F';
    ctx.beginPath(); ctx.roundRect(c - r, c - r, r * 2, r * 2, 3); ctx.fill(); ctx.stroke();
  }
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `bold ${kind === 'halt' ? 10 : 12}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(kind === 'tram_stop' ? 'Т' : 'Ж', c, c + 1);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** Tracks and platforms; added under the roads, which cross them on top. */
export function addRailLines(map: MapLibreMap): void {
  map.addLayer({ id: 'rail-platform', type: 'line', source: 'rails', filter: IS_PLATFORM as never, layout: { 'line-cap': 'butt' },
    paint: { 'line-width': zoomWidth(2, 9), 'line-opacity': 0.8 } });
  map.addLayer({ id: 'rail-base', type: 'line', source: 'rails', filter: IS_TRACK as never, layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: {
      'line-width': zoomWidth(['case', IS_TRAM, 1.2, IS_SIDE, 1.2, 2], ['case', IS_TRAM, 3, IS_SIDE, 3, 5]),
      'line-opacity': ['case', ['in', ['get', 'kind'], ['literal', ['disused', 'abandoned']]], 0.45, 1],
    } });
  // Ties: light dashes along railway tracks; tram tracks stay a plain line.
  map.addLayer({ id: 'rail-ties', type: 'line', source: 'rails', minzoom: 14, filter: ['all', IS_TRACK, ['!', IS_TRAM]] as never, layout: { 'line-cap': 'butt' },
    paint: { 'line-width': zoomWidth(1, 3), 'line-dasharray': [2, 2.5] } });
  // Metro: a line in the colour of its line on the scheme (tag colour, red without one), no ties;
  // under the ground it is dashed, as metro maps draw the tunnels.
  const metroColor = ['case', ['==', ['get', 'colour'], ''], '#D7261E', ['to-color', ['get', 'colour'], '#D7261E']];
  map.addLayer({ id: 'rail-metro', type: 'line', source: 'rails', filter: ['all', IS_METRO, ['!', ['get', 'tunnel']]] as never, layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': metroColor as never, 'line-width': zoomWidth(2.5, 7) } });
  map.addLayer({ id: 'rail-metro-tunnel', type: 'line', source: 'rails', filter: ['all', IS_METRO, ['get', 'tunnel']] as never, layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: { 'line-color': metroColor as never, 'line-width': zoomWidth(2.5, 7), 'line-opacity': 0.8, 'line-dasharray': [1.6, 1] } });
}

/** Station symbols and names, on top of the roads. */
export function addStationLayers(map: MapLibreMap): void {
  (['station', 'halt', 'tram_stop', 'subway', 'subway_entrance'] as const).forEach((k) => {
    const img = stationIcon(k);
    if (img && !map.hasImage(`station-${k}`)) map.addImage(`station-${k}`, img, { pixelRatio: 2 });
  });
  map.on('styleimagemissing', (e: { id: string }) => {
    if (!e.id.startsWith(NAME_PREFIX) || map.hasImage(e.id)) return;
    const dark = document.documentElement.dataset.theme === 'dark';
    const img = nameImage(e.id.slice(NAME_PREFIX.length), dark);
    if (img) map.addImage(e.id, img, { pixelRatio: 2 });
  });
  map.addLayer({ id: 'stations', type: 'symbol', source: 'stations', minzoom: 13,
    layout: { 'icon-image': ['concat', 'station-', ['get', 'kind']], 'icon-allow-overlap': true, 'icon-size': ['interpolate', ['linear'], ['zoom'], 13, 0.7, 17, 1] } });
  map.addLayer({ id: 'station-names', type: 'symbol', source: 'stations', minzoom: 15, filter: ['!=', ['get', 'name'], ''],
    layout: { 'icon-image': ['concat', NAME_PREFIX, ['get', 'name']], 'icon-anchor': 'left', 'icon-offset': [16, 0], 'icon-allow-overlap': false } });
}

/** Palette last applied and whether the railway view mode wants the tracks lit, per map. */
const railState = new WeakMap<MapLibreMap, { p: MapPalette | null; bright: boolean }>();

/** Track colour in the railway view: lighter than the road on a dark map, darker on a light one. */
const brightRail = (p: MapPalette) => (Number.parseInt(p.rail.slice(1, 3), 16) > 0x70 ? '#F2F2F8' : '#1C1C22');
/** Lit tracks are drawn this much wider. */
const BRIGHT_WIDEN = 1.6;

export function applyRailPalette(map: MapLibreMap, p: MapPalette): void {
  const st = railState.get(map) ?? { p: null, bright: false };
  st.p = p;
  railState.set(map, st);
  const set = (layer: string, prop: string, value: unknown) => map.setPaintProperty(layer, prop as never, value as never);
  set('rail-platform', 'line-color', p.platform);
  set('rail-base', 'line-color', ['case', IS_TRAM, p.tram, st.bright ? brightRail(p) : p.rail]);
  set('rail-ties', 'line-color', p.railTies);
  const k = st.bright ? BRIGHT_WIDEN : 1;
  set('rail-base', 'line-width', zoomWidth(['case', IS_TRAM, 1.2 * k, IS_SIDE, 1.2 * k, 2 * k], ['case', IS_TRAM, 3 * k, IS_SIDE, 3 * k, 5 * k]));
  set('rail-ties', 'line-width', zoomWidth(1 * k, 3 * k));
}

/** The railway view mode lights the tracks: a brighter colour and wider lines, kept across theme changes. */
export function setRailBright(map: MapLibreMap, on: boolean): void {
  const st = railState.get(map) ?? { p: null, bright: false };
  if (st.bright === on && st.p) return;
  st.bright = on;
  railState.set(map, st);
  if (st.p && map.getLayer('rail-base')) applyRailPalette(map, st.p);
}
