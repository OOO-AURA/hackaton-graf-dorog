import type { Map as MapLibreMap } from 'maplibre-gl';

/** Where the camera was for a file, kept between runs of the editor. */
export interface SavedCamera {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
  view3d: boolean;
}

const key = (fileName: string) => `graf-camera:${fileName}`;

export function loadCamera(fileName: string): SavedCamera | null {
  try {
    const raw = localStorage.getItem(key(fileName));
    if (!raw) return null;
    const c = JSON.parse(raw) as SavedCamera;
    const ok = Array.isArray(c.center) && c.center.every(Number.isFinite) && [c.zoom, c.bearing, c.pitch].every(Number.isFinite);
    return ok ? c : null;
  } catch {
    return null;
  }
}

export function saveCamera(fileName: string, map: MapLibreMap, view3d: boolean): void {
  const { lng, lat } = map.getCenter();
  const camera: SavedCamera = { center: [lng, lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch(), view3d };
  try { localStorage.setItem(key(fileName), JSON.stringify(camera)); } catch { /* private mode or full storage: nothing to keep */ }
}
