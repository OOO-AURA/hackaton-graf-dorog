import { useEffect } from 'react';
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent, PointLike } from 'maplibre-gl';
import { create } from 'zustand';
import {
  centroid, contains, insertVertex, moveEdge, orientedBox, removeVertex, rotate, snapCorner, translate, type P,
} from '../osm/buildingShape';
import { localOutline, setOutline } from '../osm/buildingEdit';
import { isBuilding } from '../osm/building';
import type { OsmDoc } from '../osm/types';
import { currentSelection, useEditor } from '../state/store';

/**
 * Shaping the selected building on the map: corners are dragged (keeping right angles unless Alt
 * is held), a dot in the middle of a side adds a corner there, a side is dragged out or in, the
 * ring above turns the building and dragging inside it moves it. A click on a corner picks it,
 * Delete or Alt+click removes it.
 */

export const HANDLE_LAYERS = ['bh-corner', 'bh-mid', 'bh-rotate', 'bh-edge'] as const;

const DRAG_THRESHOLD_PX = 3;
/** Pull of right angles and of whole steps of turn, in screen pixels. */
const SNAP_PX = 10;
/** The turning handle stands this far beyond the end of the building, metres. */
const ROTATE_REACH = 8;
/** Turns snap to steps of this many degrees unless Alt is held. */
const TURN_STEP = 5;

interface CornerPick { readonly way: string; readonly index: number }
export const useBuildingCorner = create<{ corner: CornerPick | null; pick: (c: CornerPick | null) => void }>((set) => ({
  corner: null,
  pick: (corner) => set({ corner }),
}));

/** The building being shaped: the selected way when it is a building. */
export function selectedBuilding(): string | null {
  const s = useEditor.getState();
  const sel = currentSelection(s);
  if (!sel || sel.type !== 'way' || s.mode !== 'select') return null;
  const way = s.doc.ways[sel.id];
  return way && isBuilding(way.tags) ? way.id : null;
}

/** Removes the picked corner of the selected building; false when there is none to remove. */
export function removePickedCorner(): boolean {
  const pick = useBuildingCorner.getState().corner;
  const id = selectedBuilding();
  if (!pick || pick.way !== id) return false;
  const s = useEditor.getState();
  const local = localOutline(s.doc, id);
  if (!local || local.ring.length <= 3) { s.notify('У здания не может быть меньше трёх углов'); return true; }
  s.apply((d) => setOutline(d, id, local.back(removeVertex(local.ring, pick.index))));
  useBuildingCorner.getState().pick(null);
  return true;
}

/** Handle geometry of a building: corners, middles of sides, sides and the turning handle. */
export function buildingHandles(doc: OsmDoc, wayId: string | null, picked: number | null) {
  const empty = { type: 'FeatureCollection', features: [] as unknown[] };
  if (!wayId) return empty;
  const local = localOutline(doc, wayId);
  if (!local) return empty;
  const { ring, back } = local;
  const ll = back(ring);
  const features: unknown[] = [];
  ring.forEach((_, i) => {
    const j = (i + 1) % ring.length;
    features.push({ type: 'Feature', properties: { kind: 'edge', index: i }, geometry: { type: 'LineString', coordinates: [ll[i], ll[j]] } });
    const [mid] = back([[(ring[i][0] + ring[j][0]) / 2, (ring[i][1] + ring[j][1]) / 2]]);
    features.push({ type: 'Feature', properties: { kind: 'mid', index: i }, geometry: { type: 'Point', coordinates: mid } });
    features.push({ type: 'Feature', properties: { kind: 'corner', index: i, picked: picked === i }, geometry: { type: 'Point', coordinates: ll[i] } });
  });
  const { knob, base } = rotateKnob(ring);
  const [k, b] = back([knob, base]);
  features.push({ type: 'Feature', properties: { kind: 'rotate-line' }, geometry: { type: 'LineString', coordinates: [b, k] } });
  features.push({ type: 'Feature', properties: { kind: 'rotate' }, geometry: { type: 'Point', coordinates: k } });
  return { type: 'FeatureCollection', features };
}

/** The turning handle: beyond the far end of the building along its long axis. */
function rotateKnob(ring: readonly P[]): { knob: P; base: P } {
  const box = orientedBox(ring);
  const u: P = [Math.sin((box.angle * Math.PI) / 180), Math.cos((box.angle * Math.PI) / 180)];
  // The end that faces north-ish, so the knob is above the building on screen.
  const s = u[1] >= 0 ? 1 : -1;
  const end = box.length / 2;
  const base: P = [box.center[0] + u[0] * end * s, box.center[1] + u[1] * end * s];
  return { base, knob: [base[0] + u[0] * ROTATE_REACH * s, base[1] + u[1] * ROTATE_REACH * s] };
}

type Drag =
  | { kind: 'corner'; index: number }
  | { kind: 'mid'; index: number }
  | { kind: 'edge'; index: number }
  | { kind: 'rotate' }
  | { kind: 'move' };

export function useBuildingEditing(map: MapLibreMap | null): void {
  useEffect(() => {
    if (!map) return undefined;
    // A removed map (hot reload, closing) has no style left to ask.
    const source = () => (map.style ? map.getSource('building-handles') as GeoJSONSource | undefined : undefined);
    const redraw = () => {
      const s = useEditor.getState();
      const pick = useBuildingCorner.getState().corner;
      const id = selectedBuilding();
      source()?.setData(buildingHandles(s.doc, id, pick && pick.way === id ? pick.index : null) as never);
    };
    redraw();
    const offEditor = useEditor.subscribe((s, prev) => {
      if (s.selection !== prev.selection) useBuildingCorner.getState().pick(null);
      if (s.doc !== prev.doc || s.selection !== prev.selection || s.mode !== prev.mode) redraw();
    });
    const offCorner = useBuildingCorner.subscribe(redraw);

    let drag: Drag | null = null;
    let wayId = '';
    let start: { ring: P[]; back: (pts: readonly P[]) => [number, number][]; m: { to: (p: [number, number]) => P } } | null = null;
    let origin = { x: 0, y: 0 };
    let from: P = [0, 0];
    let started = false;

    const metresPerPx = () => (78271.517 * Math.cos((map.getCenter().lat * Math.PI) / 180)) / 2 ** map.getZoom();
    const hit = (e: MapMouseEvent): Drag | null => {
      const pad = 6;
      const box: [PointLike, PointLike] = [[e.point.x - pad, e.point.y - pad], [e.point.x + pad, e.point.y + pad]];
      const found = map.queryRenderedFeatures(box, { layers: HANDLE_LAYERS.filter((l) => map.getLayer(l)) as unknown as string[] });
      const by = (k: string) => found.find((f) => f.properties?.kind === k);
      const c = by('corner') ?? by('mid') ?? by('rotate') ?? by('edge');
      if (c) {
        const kind = c.properties!.kind as string;
        return kind === 'rotate' ? { kind: 'rotate' } : { kind: kind as 'corner' | 'mid' | 'edge', index: Number(c.properties!.index) };
      }
      return null;
    };

    const onDown = (e: MapMouseEvent) => {
      if (e.originalEvent.button !== 0 || e.originalEvent.shiftKey) return;
      const id = selectedBuilding();
      if (!id) return;
      const local = localOutline(useEditor.getState().doc, id);
      if (!local) return;
      const at = local.m.to([e.lngLat.lng, e.lngLat.lat]);
      let d = hit(e);
      if (!d && contains(local.ring, at)) d = { kind: 'move' };
      if (!d) return;
      e.preventDefault();
      map.dragPan.disable();
      drag = d;
      wayId = id;
      start = { ring: local.ring, back: local.back, m: local.m };
      origin = e.point;
      from = at;
      started = false;
    };

    const onMove = (e: MapMouseEvent) => {
      if (!drag || !start) return;
      if (!started) {
        if (Math.hypot(e.point.x - origin.x, e.point.y - origin.y) < DRAG_THRESHOLD_PX) return;
        started = true;
        useEditor.getState().beginGesture();
      }
      const p = start.m.to([e.lngLat.lng, e.lngLat.lat]);
      const free = e.originalEvent.altKey;
      const tol = free ? 0 : SNAP_PX * metresPerPx();
      const ring = start.ring;
      const d = drag;
      let next: P[];
      switch (d.kind) {
        case 'corner': next = ring.map((q, i) => (i === d.index ? snapCorner(ring, i, p, tol) : q)); break;
        case 'mid': {
          const grown = insertVertex(ring, d.index, p);
          next = grown.map((q, i) => (i === d.index + 1 ? snapCorner(grown, i, p, tol, orientedBox(ring).angle) : q));
          break;
        }
        case 'edge': next = moveEdge(ring, d.index, [p[0] - from[0], p[1] - from[1]]); break;
        case 'move': next = translate(ring, [p[0] - from[0], p[1] - from[1]]); break;
        case 'rotate': {
          const c = centroid(ring);
          const a0 = Math.atan2(from[0] - c[0], from[1] - c[1]);
          const a1 = Math.atan2(p[0] - c[0], p[1] - c[1]);
          let delta = ((a1 - a0) * 180) / Math.PI;
          if (!free) delta = Math.round(delta / TURN_STEP) * TURN_STEP;
          next = rotate(ring, delta, c);
          break;
        }
      }
      const ll = start.back(next);
      useEditor.getState().applyLive((d) => setOutline(d, wayId, ll));
    };

    const onUp = (e: MapMouseEvent) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      map.dragPan.enable();
      if (started) return;
      // A click on a corner picks it; with Alt it goes at once.
      if (d.kind === 'corner') {
        useBuildingCorner.getState().pick({ way: wayId, index: d.index });
        if (e.originalEvent.altKey) removePickedCorner();
      }
    };

    map.on('mousedown', onDown);
    map.on('mousemove', onMove);
    map.on('mouseup', onUp);
    return () => {
      offEditor();
      offCorner();
      map.off('mousedown', onDown);
      map.off('mousemove', onMove);
      map.off('mouseup', onUp);
    };
  }, [map]);
}
