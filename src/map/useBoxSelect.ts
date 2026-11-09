import { useEffect } from 'react';
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import { isDrivable } from '../osm/tags';
import type { OsmDoc } from '../osm/types';
import { useEditor } from '../state/store';
import { zoneEditingActive } from '../macro/useZoneEditing';

type Rect = { x0: number; y0: number; x1: number; y1: number };

/**
 * Ways inside a screen rectangle: buildings whose centre falls in it, roads with a node in it.
 * Points are projected on the ground.
 */
export function waysInRect(doc: OsmDoc, rect: Rect, project: (lon: number, lat: number) => { x: number; y: number }): string[] {
  const [x0, x1] = [Math.min(rect.x0, rect.x1), Math.max(rect.x0, rect.x1)];
  const [y0, y1] = [Math.min(rect.y0, rect.y1), Math.max(rect.y0, rect.y1)];
  const inside = (lon: number, lat: number) => {
    const p = project(lon, lat);
    return p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
  };
  const ids: string[] = [];
  Object.values(doc.ways).forEach((w) => {
    const nodes = w.refs.map((r) => doc.nodes[r]).filter(Boolean);
    if (!nodes.length) return;
    if (w.tags.building) {
      const ring = nodes.length > 1 && nodes[0] === nodes[nodes.length - 1] ? nodes.slice(0, -1) : nodes;
      const lon = ring.reduce((s, n) => s + n.lon, 0) / ring.length;
      const lat = ring.reduce((s, n) => s + n.lat, 0) / ring.length;
      if (inside(lon, lat)) ids.push(w.id);
    } else if (isDrivable(w.tags) && nodes.some((n) => inside(n.lon, n.lat))) {
      ids.push(w.id);
    }
  });
  return ids;
}

/** Shift + drag on the map draws a frame and selects the buildings and roads inside it. */
export function useBoxSelect(map: MapLibreMap | null): void {
  useEffect(() => {
    if (!map) return undefined;
    map.boxZoom.disable();
    let start: { x: number; y: number } | null = null;
    let frame: HTMLDivElement | null = null;

    const draw = (x: number, y: number) => {
      if (!start) return;
      if (!frame) {
        frame = document.createElement('div');
        frame.className = 'box-select';
        map.getCanvasContainer().appendChild(frame);
      }
      Object.assign(frame.style, {
        left: `${Math.min(start.x, x)}px`, top: `${Math.min(start.y, y)}px`,
        width: `${Math.abs(x - start.x)}px`, height: `${Math.abs(y - start.y)}px`,
      });
    };
    const onDown = (e: MapMouseEvent) => {
      const s = useEditor.getState();
      if (!e.originalEvent.shiftKey || e.originalEvent.button !== 0 || s.mode !== 'select' || zoneEditingActive()) return;
      e.preventDefault();
      start = e.point;
      map.dragPan.disable();
    };
    const onMove = (e: MapMouseEvent) => { if (start) draw(e.point.x, e.point.y); };
    const onUp = (e: MapMouseEvent) => {
      if (!start) return;
      const rect = { x0: start.x, y0: start.y, x1: e.point.x, y1: e.point.y };
      start = null;
      frame?.remove();
      frame = null;
      map.dragPan.enable();
      if (Math.abs(rect.x1 - rect.x0) < 4 && Math.abs(rect.y1 - rect.y0) < 4) return;
      const s = useEditor.getState();
      s.selectMany(waysInRect(s.doc, rect, (lon, lat) => map.project([lon, lat])));
    };
    map.on('mousedown', onDown);
    map.on('mousemove', onMove);
    map.on('mouseup', onUp);
    return () => {
      map.off('mousedown', onDown);
      map.off('mousemove', onMove);
      map.off('mouseup', onUp);
      frame?.remove();
    };
  }, [map]);
}
