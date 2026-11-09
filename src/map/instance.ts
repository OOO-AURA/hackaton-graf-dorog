import type { Map as MapLibreMap } from 'maplibre-gl';

let current: MapLibreMap | null = null;

/** The live map, for features outside the map component such as the report snapshot. */
export const setMapInstance = (map: MapLibreMap | null) => { current = map; };

/** JPEG of the map as it is on screen; null when there is no map or the canvas cannot be read. */
export function mapSnapshot(): Promise<string | null> {
  const map = current;
  if (!map) return Promise.resolve(null);
  return new Promise((resolve) => {
    // The WebGL buffer is only readable right after a frame is drawn.
    map.once('render', () => {
      try { resolve(map.getCanvas().toDataURL('image/jpeg', 0.85)); } catch { resolve(null); }
    });
    map.triggerRepaint();
    setTimeout(() => resolve(null), 3000);
  });
}
