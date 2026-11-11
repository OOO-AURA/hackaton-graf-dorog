import { useEffect } from 'react';
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import { create } from 'zustand';
import { BUILDING_TEMPLATES, bearingOf, contains, rectangle, type P } from '../osm/buildingShape';
import { metres, placeTemplate, templateTags, type LonLat } from '../osm/buildingEdit';
import { buildingHeight } from '../osm/height';
import { isDrivable } from '../osm/tags';
import type { OsmDoc } from '../osm/types';
import { useEditor } from '../state/store';
import { roadWidthMetres } from './lanesGeo';

/**
 * The building tool (B): a see-through ghost of the chosen template follows the cursor, lines up
 * with the nearest road, turns with R, and a click puts the building there.
 */

/** How far a road may be for the ghost to line up with it, metres. */
const ALIGN_RADIUS = 40;
/** Gap between a building lined up with a road and the edge of its carriageway, metres. */
const SETBACK = 4;

interface BuildingToolState {
  /** Index into BUILDING_TEMPLATES. */
  template: number;
  /** Turn added by R, degrees clockwise. */
  turn: number;
  /** Alt held: the ghost does not line up with roads. */
  free: boolean;
  /** Where the ghost is, for the hint and for placing; null while the cursor is off the map. */
  ghost: Ghost | null;
  setTemplate: (i: number) => void;
  rotate: (by: number) => void;
  setFree: (free: boolean) => void;
  setGhost: (g: Ghost | null) => void;
}

export interface Ghost {
  readonly center: LonLat;
  readonly angle: number;
  readonly ring: LonLat[];
  /** The ghost covers a road: placing it there is allowed, but it is shown in warning red. */
  readonly onRoad: boolean;
  /** It lined up with a road. */
  readonly aligned: boolean;
}

export const useBuildingTool = create<BuildingToolState>((set) => ({
  template: 1,
  turn: 0,
  free: false,
  ghost: null,
  setTemplate: (template) => set({ template }),
  rotate: (by) => set((s) => ({ turn: (((s.turn + by) % 360) + 360) % 360 })),
  setFree: (free) => set({ free }),
  setGhost: (ghost) => set({ ghost }),
}));

/** Distance from `p` to segment a–b, and the closest point. */
function toSegment(p: P, a: P, b: P): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Nearby road segments around a point, in local metres, with the half width of their road. */
function nearbySegments(doc: OsmDoc, center: LonLat, radius: number) {
  const m = metres(center[1]);
  const c = m.to(center);
  const out: Array<{ a: P; b: P; half: number; d: number }> = [];
  const degLat = radius / 111_000;
  const degLon = degLat / Math.cos((center[1] * Math.PI) / 180);
  for (const w of Object.values(doc.ways)) {
    if (!isDrivable(w.tags) || w.refs.length < 2) continue;
    const half = roadWidthMetres(w.tags) / 2;
    for (let i = 0; i + 1 < w.refs.length; i += 1) {
      const [na, nb] = [doc.nodes[w.refs[i]], doc.nodes[w.refs[i + 1]]];
      if (!na || !nb) continue;
      if (Math.min(na.lon, nb.lon) > center[0] + degLon || Math.max(na.lon, nb.lon) < center[0] - degLon) continue;
      if (Math.min(na.lat, nb.lat) > center[1] + degLat || Math.max(na.lat, nb.lat) < center[1] - degLat) continue;
      const [a, b] = [m.to([na.lon, na.lat]), m.to([nb.lon, nb.lat])];
      const d = toSegment(c, a, b);
      if (d <= radius) out.push({ a, b, half, d });
    }
  }
  return { m, c, segments: out };
}

/** Whether an outline in local metres covers any of the road segments (their carriageway). */
function coversRoad(ring: readonly P[], segments: ReadonlyArray<{ a: P; b: P; half: number }>): boolean {
  const edgeDist = (p: P) => Math.min(...ring.map((a, i) => toSegment(p, a, ring[(i + 1) % ring.length])));
  return segments.some(({ a, b, half }) => {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2));
    for (let k = 0; k <= n; k += 1) {
      const p: P = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
      if (contains(ring, p) || edgeDist(p) < half) return true;
    }
    return false;
  });
}

/** Size of what a ghost stands for, metres: across and along its long axis. */
export interface Footprint { readonly width: number; readonly length: number }

/**
 * The ghost of template `template` (a building template's index, or any footprint, such as a car
 * park) at `center`: lined up with the nearest road unless `free`.
 */
export function ghostAt(doc: OsmDoc, center: LonLat, template: number | Footprint, turn: number, free: boolean): Ghost {
  const t: Footprint = typeof template === 'number' ? (BUILDING_TEMPLATES[template] ?? BUILDING_TEMPLATES[0]) : template;
  const { m, c, segments } = nearbySegments(doc, center, Math.max(ALIGN_RADIUS, t.length));
  const nearest = segments.filter((s) => s.d <= ALIGN_RADIUS).sort((x, y) => x.d - y.d)[0];
  const aligned = !free && Boolean(nearest);
  const angle = ((aligned ? bearingOf(nearest.a, nearest.b) : 0) + turn) % 360;
  let at = c;
  if (aligned) {
    // Set back from the road like a building on a street: its side to the road a few metres off
    // the carriageway, on the side of the cursor.
    const { a, b, half } = nearest;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const n: P = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
    const side = (c[0] - a[0]) * n[0] + (c[1] - a[1]) * n[1];
    // The building's depth across the road, whichever way it is turned.
    const turned = ((angle - bearingOf(a, b)) % 180 + 180) % 180;
    const depth = Math.abs(Math.cos((turned * Math.PI) / 180)) * t.width + Math.abs(Math.sin((turned * Math.PI) / 180)) * t.length;
    const want = half + SETBACK + depth / 2;
    if (Math.abs(side) < want) {
      const k = (side >= 0 ? 1 : -1) * want - side;
      at = [c[0] + n[0] * k, c[1] + n[1] * k];
    }
  }
  const local = rectangle(at, t.width, t.length, angle);
  return { center: m.back(at), angle, ring: local.map(m.back), onRoad: coversRoad(local, segments), aligned };
}

/** Puts the current ghost into the document as a building and returns its id. */
export function placeGhost(): string {
  const { ghost, template } = useBuildingTool.getState();
  if (!ghost) return '';
  let id = '';
  useEditor.getState().apply((d) => {
    const r = placeTemplate(d, ghost.center, BUILDING_TEMPLATES[template], ghost.angle);
    id = r.id;
    return r.doc;
  });
  return id;
}

const EMPTY = { type: 'FeatureCollection', features: [] };

/** Ghost geometry for the map: the footprint with the height the building will get. */
function ghostFeatures(g: Ghost | null, template: number) {
  if (!g) return EMPTY;
  const height = buildingHeight(templateTags(BUILDING_TEMPLATES[template])).height;
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: { height, warn: g.onRoad }, geometry: { type: 'Polygon', coordinates: [[...g.ring, g.ring[0]]] } }],
  };
}

/** Keeps the ghost under the cursor while the building tool is on. */
export function useBuildingGhost(map: MapLibreMap | null): void {
  useEffect(() => {
    if (!map) return undefined;
    // A removed map (hot reload, closing) has no style left to ask.
    const source = () => (map.style ? map.getSource('ghost') as GeoJSONSource | undefined : undefined);
    let last: LonLat | null = null;
    const redraw = () => {
      const s = useEditor.getState();
      const tool = useBuildingTool.getState();
      const g = s.mode === 'building' && last ? ghostAt(s.doc, last, tool.template, tool.turn, tool.free) : null;
      tool.setGhost(g);
      source()?.setData(ghostFeatures(g, tool.template) as never);
    };
    const onMove = (e: MapMouseEvent) => {
      if (useEditor.getState().mode !== 'building') return;
      last = [e.lngLat.lng, e.lngLat.lat];
      const free = Boolean(e.originalEvent.altKey);
      if (free !== useBuildingTool.getState().free) useBuildingTool.getState().setFree(free);
      redraw();
    };
    const onOut = () => { last = null; redraw(); };
    map.on('mousemove', onMove);
    map.on('mouseout', onOut);
    // Template, turn or mode changes redraw the ghost where the cursor is.
    const offTool = useBuildingTool.subscribe((s, prev) => { if (s.template !== prev.template || s.turn !== prev.turn || s.free !== prev.free) redraw(); });
    const offMode = useEditor.subscribe((s, prev) => { if (s.mode !== prev.mode || (s.mode === 'building' && s.doc !== prev.doc)) redraw(); });
    return () => {
      map.off('mousemove', onMove);
      map.off('mouseout', onOut);
      offTool();
      offMode();
    };
  }, [map]);
}
