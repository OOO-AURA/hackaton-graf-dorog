import { useEffect } from 'react';
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import { useUi } from '../state/ui';
import { useMacro } from './store';

const HIT_PX = 10;

const zoneAt = (map: MapLibreMap, e: MapMouseEvent): number | null => {
  const box: [[number, number], [number, number]] = [[e.point.x - HIT_PX, e.point.y - HIT_PX], [e.point.x + HIT_PX, e.point.y + HIT_PX]];
  const hit = map.queryRenderedFeatures(box, { layers: ['macro-zone'] })[0];
  const idx = hit?.properties?.idx;
  return typeof idx === 'number' ? idx : null;
};

export const zoneEditingActive = () => useMacro.getState().placing && useUi.getState().workspace === 'macro';

/**
 * Hand-placed zones: click on empty map adds a centroid, dragging moves it,
 * right click or Alt+click removes it. Flows are recalculated after each change.
 */
export function useZoneEditing(map: MapLibreMap | null): void {
  useEffect(() => {
    if (!map) return undefined;
    let drag: number | null = null;
    let moved = false;
    const points = () => useMacro.getState().points ?? [];
    const commit = (next: Array<[number, number]>) => {
      useMacro.getState().setPoints(next);
      if (next.length >= 2) void useMacro.getState().run();
    };

    const onDown = (e: MapMouseEvent) => {
      if (!zoneEditingActive() || e.originalEvent.button !== 0 || e.originalEvent.altKey) return;
      const idx = zoneAt(map, e);
      if (idx === null) return;
      e.preventDefault();
      drag = idx; moved = false;
      map.dragPan.disable();
    };
    const onMove = (e: MapMouseEvent) => {
      if (!zoneEditingActive()) return;
      if (drag === null) { map.getCanvas().style.cursor = zoneAt(map, e) === null ? 'copy' : 'grab'; return; }
      moved = true;
      const next = points().slice();
      next[drag] = [e.lngLat.lng, e.lngLat.lat];
      useMacro.setState({ points: next });
    };
    const onUp = () => {
      if (drag === null) return;
      drag = null;
      map.dragPan.enable();
      if (moved) commit(points());
    };
    const remove = (e: MapMouseEvent) => {
      const idx = zoneAt(map, e);
      if (idx !== null) commit(points().filter((_, i) => i !== idx));
    };
    const onClick = (e: MapMouseEvent) => {
      if (!zoneEditingActive() || moved) { moved = false; return; }
      if (e.originalEvent.altKey) { remove(e); return; }
      if (zoneAt(map, e) !== null) return;
      commit([...points(), [e.lngLat.lng, e.lngLat.lat]]);
    };
    const onContext = (e: MapMouseEvent) => { if (zoneEditingActive()) { e.preventDefault(); remove(e); } };
    map.on('mousedown', onDown);
    map.on('mousemove', onMove);
    map.on('mouseup', onUp);
    map.on('click', onClick);
    map.on('contextmenu', onContext);
    return () => {
      map.off('mousedown', onDown); map.off('mousemove', onMove); map.off('mouseup', onUp);
      map.off('click', onClick); map.off('contextmenu', onContext);
    };
  }, [map]);
}
