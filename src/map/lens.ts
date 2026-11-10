import type { Map as MapLibreMap } from 'maplibre-gl';
import { JUNCTION_LAYERS } from './junctionLayers';
import { RAIL_LAYERS } from './railLayers';

/**
 * Lenses: one map, looked at for one kind of traveller. A lens keeps its own layers at full
 * strength and fades the rest, so the network it is about stands out without losing context.
 */
export type Lens = 'all' | 'car' | 'signs' | 'walk' | 'transit' | 'rail' | 'metro' | 'load';

/** The view modes in the order of the menu; see editScope.ts for what each lets one edit. */
export const LENSES: ReadonlyArray<readonly [Lens, string]> = [
  ['all', 'Все объекты'], ['car', 'Авто · общий вид'], ['signs', 'Авто · знаки и светофоры'], ['walk', 'Пешеходы'],
  ['transit', 'Общественный транспорт'], ['rail', 'Железная дорога'], ['metro', 'Метро'], ['load', 'Загрузка'],
];

type Group = 'road' | 'control' | 'walk' | 'transit' | 'rail' | 'load';

const ROAD = ['roads-casing', 'bridge-casing', 'roads', 'roads-arrows', 'lanes', 'lane-marks-casing', 'lane-marks-dash', 'lane-marks-solid', 'nodes', ...JUNCTION_LAYERS.filter((l) => !l.startsWith('zebra'))];
/** Traffic control: lights, priority signs and crossings, the job of the signs view. */
const CONTROL = ['signals', 'signs', 'road-signs', 'crossings'];
const GROUPS: Record<Group, readonly string[]> = {
  road: ROAD,
  control: CONTROL,
  walk: ['context', 'context-casing', 'context-steps', 'sidewalk-left', 'sidewalk-right', 'zebra-base', 'zebra-stripes'],
  transit: ['transit-line', 'transit-stop'],
  rail: RAIL_LAYERS,
  load: ['macro-flow'],
};

const KEEP: Record<Lens, ReadonlySet<Group>> = {
  all: new Set(['road', 'control', 'walk', 'transit', 'rail', 'load']),
  car: new Set(['road']),
  signs: new Set(['control']),
  walk: new Set(['walk', 'control']),
  transit: new Set(['transit', 'rail']),
  rail: new Set(['rail']),
  metro: new Set(['rail']),
  load: new Set(['load']),
};

const FADED = 0.14;

const PROPS: Record<string, string[]> = {
  line: ['line-opacity'], circle: ['circle-opacity', 'circle-stroke-opacity'], symbol: ['icon-opacity', 'text-opacity'], fill: ['fill-opacity'],
};

const originals = new WeakMap<MapLibreMap, Map<string, unknown>>();

function setOpacity(map: MapLibreMap, layer: string, k: number | unknown[]): void {
  const l = map.getLayer(layer);
  if (!l) return;
  const store = originals.get(map) ?? new Map<string, unknown>();
  originals.set(map, store);
  for (const prop of PROPS[l.type] ?? []) {
    const key = `${layer}|${prop}`;
    if (!store.has(key)) store.set(key, map.getPaintProperty(layer, prop));
    const orig = store.get(key);
    let value: unknown = orig;
    if (k !== 1) value = typeof k === 'number' && typeof orig === 'number' ? orig * k : k;
    map.setPaintProperty(layer, prop, value as never);
  }
}

/** In the walking lens paths and sidewalks are drawn bright and a little wider, so they read over the faded roads. */
const WALK_COLOR = '#F4E7C2';
const WALK_WIDEN = 1.5;
const WALK_LAYERS = ['context', 'sidewalk-left', 'sidewalk-right'];
const paintOriginals = new WeakMap<MapLibreMap, Map<string, unknown>>();

function setPaint(map: MapLibreMap, layer: string, prop: string, value: ((orig: unknown) => unknown) | null): void {
  if (!map.getLayer(layer)) return;
  const store = paintOriginals.get(map) ?? new Map<string, unknown>();
  paintOriginals.set(map, store);
  const key = `${layer}|${prop}`;
  if (!store.has(key)) store.set(key, map.getPaintProperty(layer, prop));
  map.setPaintProperty(layer, prop, (value ? value(store.get(key)) : store.get(key)) as never);
}

/** A width scaled by `k`: a zoom curve has to stay the outer expression, so each of its stops is scaled. */
function widen(width: unknown, k: number): unknown {
  if (typeof width === 'number') return width * k;
  if (Array.isArray(width) && width[0] === 'interpolate') {
    return [...width.slice(0, 3), ...width.slice(3).map((v, i) => (i % 2 === 1 ? ['*', k, v] : v))];
  }
  return width;
}

function highlightWalking(map: MapLibreMap, on: boolean): void {
  WALK_LAYERS.forEach((layer) => {
    setPaint(map, layer, 'line-color', on ? () => WALK_COLOR : null);
    setPaint(map, layer, 'line-width', on ? (orig) => widen(orig, WALK_WIDEN) : null);
  });
}

export function applyLens(map: MapLibreMap, lens: Lens): void {
  const keep = KEEP[lens];
  highlightWalking(map, lens === 'walk');
  (Object.keys(GROUPS) as Group[]).forEach((g) => {
    GROUPS[g].forEach((layer) => {
      if (lens === 'metro' && g === 'rail') {
        // Metro only: its lines and its stations, the railway faded.
        setOpacity(map, layer, layer === 'rail-metro' || layer === 'rail-metro-tunnel' ? 1 : layer === 'stations' || layer === 'station-names' ? ['case', ['in', ['get', 'kind'], ['literal', ['subway', 'subway_entrance']]], 1, FADED] : FADED);
      } else setOpacity(map, layer, keep.has(g) ? 1 : (lens === 'load' || lens === 'signs') && g === 'road' ? 0.45 : FADED);
    });
  });
}
