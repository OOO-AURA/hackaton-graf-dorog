import { useEffect } from 'react';
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import { create } from 'zustand';
import type { LonLat } from '../osm/buildingEdit';
import { PARKING_TEMPLATES, placeParking } from '../osm/parking';
import { useEditor } from '../state/store';
import { ghostAt, type Ghost } from './buildingTool';

/**
 * The car park tool (K): a flat ghost of the chosen lot follows the cursor, lines up with the
 * nearest road and stands a few metres off it, as the building tool does; R turns it, a click
 * puts the car park there. Its shape is then changed with the same handles as a building's.
 */

interface ParkingToolState {
  /** Index into PARKING_TEMPLATES. */
  template: number;
  /** Turn added by R, degrees clockwise. */
  turn: number;
  /** Alt held: the ghost does not line up with roads. */
  free: boolean;
  ghost: Ghost | null;
  setTemplate: (i: number) => void;
  rotate: (by: number) => void;
  setFree: (free: boolean) => void;
  setGhost: (g: Ghost | null) => void;
}

export const useParkingTool = create<ParkingToolState>((set) => ({
  template: 1,
  turn: 0,
  free: false,
  ghost: null,
  setTemplate: (template) => set({ template: Math.max(0, Math.min(PARKING_TEMPLATES.length - 1, template)) }),
  rotate: (by) => set((s) => ({ turn: (((s.turn + by) % 360) + 360) % 360 })),
  setFree: (free) => set({ free }),
  setGhost: (ghost) => set({ ghost }),
}));

/** The ghost of the current template at `center`. */
export function parkingGhostAt(center: LonLat): Ghost {
  const { template, turn, free } = useParkingTool.getState();
  return ghostAt(useEditor.getState().doc, center, PARKING_TEMPLATES[template], turn, free);
}

/** Puts the current ghost into the document as a car park and returns its id ('' without a ghost). */
export function placeParkingGhost(): string {
  const { ghost, template } = useParkingTool.getState();
  if (!ghost) return '';
  let id = '';
  useEditor.getState().apply((d) => {
    const r = placeParking(d, ghost.center, PARKING_TEMPLATES[template], ghost.angle);
    id = r.id;
    return r.doc;
  });
  return id;
}

const EMPTY = { type: 'FeatureCollection', features: [] };

const ghostFeatures = (g: Ghost | null) => (g
  ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { warn: g.onRoad }, geometry: { type: 'Polygon', coordinates: [[...g.ring, g.ring[0]]] } }] }
  : EMPTY);

/** Keeps the ghost under the cursor while the car park tool is on. */
export function useParkingGhost(map: MapLibreMap | null): void {
  useEffect(() => {
    if (!map) return undefined;
    // A removed map (hot reload, closing) has no style left to ask.
    const source = () => (map.style ? map.getSource('parking-ghost') as GeoJSONSource | undefined : undefined);
    let last: LonLat | null = null;
    const redraw = () => {
      const g = useEditor.getState().mode === 'parking' && last ? parkingGhostAt(last) : null;
      useParkingTool.getState().setGhost(g);
      source()?.setData(ghostFeatures(g) as never);
    };
    const onMove = (e: MapMouseEvent) => {
      if (useEditor.getState().mode !== 'parking') return;
      last = [e.lngLat.lng, e.lngLat.lat];
      const free = Boolean(e.originalEvent.altKey);
      if (free !== useParkingTool.getState().free) useParkingTool.getState().setFree(free);
      redraw();
    };
    const onOut = () => { last = null; redraw(); };
    map.on('mousemove', onMove);
    map.on('mouseout', onOut);
    const offTool = useParkingTool.subscribe((s, prev) => { if (s.template !== prev.template || s.turn !== prev.turn || s.free !== prev.free) redraw(); });
    const offMode = useEditor.subscribe((s, prev) => { if (s.mode !== prev.mode || (s.mode === 'parking' && s.doc !== prev.doc)) redraw(); });
    return () => {
      map.off('mousemove', onMove);
      map.off('mouseout', onOut);
      offTool();
      offMode();
    };
  }, [map]);
}
