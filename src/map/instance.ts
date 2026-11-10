import type { Map as MapLibreMap } from 'maplibre-gl';

let current: MapLibreMap | null = null;

/** The live map, for features outside the map component such as the report snapshot. */
export const setMapInstance = (map: MapLibreMap | null) => {
  current = map;
  // In development the map is reachable from the console and from browser checks.
  if (import.meta.env.DEV) (window as unknown as { __map: unknown }).__map = map;
};

/** JPEG of the map as it is on screen; null when there is no map or the canvas cannot be read. */
export function mapSnapshot(): Promise<string | null> {
  const map = current;
  if (!map) return Promise.resolve(null);
  return new Promise((resolve) => {
    // The WebGL buffer is only readable right after a frame is drawn.
    const onRender = () => {
      clearTimeout(timer);
      try { resolve(map.getCanvas().toDataURL('image/jpeg', 0.85)); } catch { resolve(null); }
    };
    const timer = setTimeout(() => { map.off('render', onRender); resolve(null); }, 3000);
    map.once('render', onRender);
    map.triggerRepaint();
  });
}

/** Visible map area as [south, west, north, east]; null before the map is ready. */
export function mapViewBbox(): [number, number, number, number] | null {
  if (!current) return null;
  const b = current.getBounds();
  return [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()];
}
