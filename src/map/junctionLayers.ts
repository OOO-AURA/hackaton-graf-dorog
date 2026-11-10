import type { Map as MapLibreMap } from 'maplibre-gl';
import { provideTurnArrows, TURN_ARROW_HEIGHT } from './turnArrows';
import { addRoadSignImages } from './roadSigns';

/**
 * Map layers of junctions, drawn like an engineering plan: the junction outline, zebras and stop
 * lines, the movements as ribbons coloured by turn (straight on teal, right blue, left orange,
 * U-turn pink) with a centre line, and the turn arrows painted on the lanes. Close in only: from
 * zoom 16.5, where lanes are wide enough to tell apart.
 */

export const JUNCTION_SOURCES = ['junction-areas', 'stop-lines', 'lane-arrows', 'zebras', 'road-signs'] as const;
export const JUNCTION_LAYERS = [
  'junction-area-fill', 'junction-area-line', 'zebra-base', 'zebra-stripes', 'stop-lines', 'yield-lines', 'lane-ribbons', 'lane-links', 'lane-arrows', 'lane-ends',
] as const;
/**
 * Flat junction drawings that would lie on the ground under a deck or an embankment in 3D: those
 * of junctions up on an embankment, and lane arrows of bridge and tunnel approaches. Their
 * filters in 3D add `raised != true` to the base filter.
 */
export const UNDER_DECK_LAYERS: Readonly<Record<string, unknown>> = {
  'junction-area-fill': null, 'junction-area-line': null, 'lane-ribbons': null, 'lane-links': null, 'lane-arrows': null,
  'stop-lines': ['==', ['get', 'kind'], 'stop'], 'yield-lines': ['==', ['get', 'kind'], 'yield'],
};
/** Signs are drawn in 2D only. */
export const SIGN_LAYER = 'road-signs';

export const TURN_COLORS = { through: '#2CC7C9', right: '#4C8DF6', left: '#F2A33A', uturn: '#E86AB4' } as const;
const turnColor = ['match', ['get', 'group'], 'right', TURN_COLORS.right, 'left', TURN_COLORS.left, 'uturn', TURN_COLORS.uturn, TURN_COLORS.through];

const MINZOOM = 16.5;
/** How long an arrow is on the road, in lane widths; its width then stays inside the lane. */
const ARROW_LANES = 1.35;

/**
 * A width of `w17` px at zoom 17 (a size in metres), doubling per zoom step like the roads, and
 * never thinner than `min` px. Zoom must be the outer expression, so the floor goes inside it.
 */
const metres = (scale = 1, min = 0) => ['interpolate', ['exponential', 2], ['zoom'],
  16, ['max', min, ['*', scale / 2, ['get', 'w17']]], 22, ['max', min, ['*', scale * 32, ['get', 'w17']]]] as never;

const LINE = { 'line-cap': 'butt', 'line-join': 'round' } as const;

export function addJunctionLayers(map: MapLibreMap): void {
  provideTurnArrows(map);
  map.addLayer({ id: 'junction-area-fill', type: 'fill', source: 'junction-areas', minzoom: MINZOOM,
    paint: { 'fill-color': '#4C8DF6', 'fill-opacity': ['case', ['get', 'edit'], 0.12, 0.05] } });
  map.addLayer({ id: 'junction-area-line', type: 'line', source: 'junction-areas', minzoom: MINZOOM, layout: LINE,
    paint: { 'line-color': '#7FA7E8', 'line-width': ['case', ['get', 'edit'], 1.6, 1], 'line-dasharray': [3, 3], 'line-opacity': ['case', ['get', 'edit'], 0.95, 0.6] } });
  // A zebra: a yellow band across the road with white stripes, like the Russian GOST marking 1.14.
  map.addLayer({ id: 'zebra-base', type: 'line', source: 'zebras', minzoom: MINZOOM, layout: LINE,
    paint: { 'line-color': '#F2C230', 'line-width': metres() } });
  map.addLayer({ id: 'zebra-stripes', type: 'line', source: 'zebras', minzoom: MINZOOM, layout: LINE,
    paint: { 'line-color': '#FFFFFF', 'line-width': metres(), 'line-dasharray': [0.18, 0.18] } });
  map.addLayer({ id: 'stop-lines', type: 'line', source: 'stop-lines', minzoom: MINZOOM, layout: LINE, filter: ['==', ['get', 'kind'], 'stop'],
    paint: { 'line-color': '#FFFFFF', 'line-width': metres(1, 1.5), 'line-opacity': 0.95 } });
  // Give-way line 1.13: a row of short white marks across the lanes.
  map.addLayer({ id: 'yield-lines', type: 'line', source: 'stop-lines', minzoom: MINZOOM, layout: LINE, filter: ['==', ['get', 'kind'], 'yield'],
    paint: { 'line-color': '#FFFFFF', 'line-width': metres(1, 1.5), 'line-dasharray': [0.7, 0.7], 'line-opacity': 0.95 } });
  map.addLayer({ id: 'lane-ribbons', type: 'line', source: 'lane-links', minzoom: MINZOOM, layout: LINE,
    paint: { 'line-color': turnColor as never, 'line-width': metres(0.85), 'line-opacity': ['case', ['get', 'picked'], 0.6, ['get', 'edit'], 0.34, 0.2] } });
  map.addLayer({ id: 'lane-links', type: 'line', source: 'lane-links', minzoom: MINZOOM, layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': turnColor as never,
      'line-width': ['case', ['get', 'picked'], 4, ['get', 'edit'], 2.4, 1.4],
      'line-opacity': ['case', ['get', 'edit'], 1, 0.75],
    } });
  map.addLayer({ id: 'lane-arrows', type: 'symbol', source: 'lane-arrows', minzoom: MINZOOM,
    layout: {
      'icon-image': ['get', 'icon'], 'icon-rotate': ['get', 'bearing'], 'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map',
      'icon-allow-overlap': true, 'icon-ignore-placement': true,
      'icon-size': metres(ARROW_LANES / TURN_ARROW_HEIGHT),
    } });
  addRoadSignImages(map);
  map.addLayer({ id: SIGN_LAYER, type: 'symbol', source: 'road-signs', minzoom: 16,
    layout: {
      'icon-image': ['concat', 'road-sign-', ['get', 'sign']], 'icon-allow-overlap': true, 'icon-ignore-placement': true,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 16, 0.7, 18, 1, 20, 1.5],
    } });
  map.addLayer({ id: 'lane-ends', type: 'circle', source: 'lane-ends', minzoom: 16,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 16, 4, 19, 8],
      'circle-color': ['case', ['get', 'hot'], ['match', ['get', 'kind'], 'in', '#E5392A', '#3F8BC4'], '#FBF6EA'],
      'circle-stroke-width': 2.5,
      'circle-stroke-color': ['match', ['get', 'kind'], 'in', '#E5392A', '#3F8BC4'],
    } });
}
