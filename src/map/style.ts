import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import type { Theme } from '../state/ui';
import { MAP_PALETTE } from './palette';

export const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const SATELLITE_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

export const BASE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: { type: 'raster', tiles: [OSM_TILES], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors' },
    satellite: { type: 'raster', tiles: [SATELLITE_TILES], tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': MAP_PALETTE.light.background } },
    { id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-saturation': -1, 'raster-contrast': -0.15 } },
    { id: 'satellite', type: 'raster', source: 'satellite', layout: { visibility: 'none' } },
  ],
};

/**
 * Tones the OSM scheme to the paper: the tiles are fully desaturated and laid semi-transparent
 * over the cream background, so the greys pick up its warmth. In the dark theme the tiles are
 * inverted (brightness-min above brightness-max) to sit on the brown paper.
 */
export function applyBasemapTone(map: MapLibreMap, theme: Theme, opacity: number): void {
  map.setPaintProperty('background', 'background-color', MAP_PALETTE[theme].background);
  const dark = theme === 'dark';
  map.setPaintProperty('osm', 'raster-opacity', opacity * (dark ? 0.55 : 0.6));
  map.setPaintProperty('osm', 'raster-brightness-min', dark ? 0.85 : 0);
  map.setPaintProperty('osm', 'raster-brightness-max', dark ? 0.08 : 1);
  map.setPaintProperty('satellite', 'raster-opacity', opacity);
  map.setPaintProperty('satellite', 'raster-saturation', dark ? -0.2 : 0);
}
