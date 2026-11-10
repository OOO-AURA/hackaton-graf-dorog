import type { Map as MapLibreMap } from 'maplibre-gl';
import { JUNCTION_LAYERS } from './junctionLayers';
import { RAIL_LAYERS } from './railLayers';

/**
 * Lenses: one map, looked at for one kind of traveller. A lens keeps its own layers at full
 * strength and fades the rest, so the network it is about stands out without losing context.
 */
export type Lens = 'all' | 'car' | 'walk' | 'transit' | 'rail' | 'metro' | 'load';

export const LENSES: ReadonlyArray<readonly [Lens, string]> = [
  ['all', 'Все'], ['car', 'Авто'], ['walk', 'Пешеходы'], ['transit', 'ОТ'], ['rail', 'ЖД'], ['metro', 'Метро'], ['load', 'Загруженность'],
];

type Group = 'road' | 'walk' | 'transit' | 'rail' | 'load';

const ROAD = ['roads-casing', 'bridge-casing', 'roads', 'roads-arrows', 'lanes', 'lane-marks-casing', 'lane-marks-dash', 'lane-marks-solid', 'nodes', 'signals', 'signs', ...JUNCTION_LAYERS.filter((l) => !l.startsWith('zebra'))];
const GROUPS: Record<Group, readonly string[]> = {
  road: ROAD,
  walk: ['context', 'context-casing', 'context-steps', 'sidewalk-left', 'sidewalk-right', 'crossings', 'zebra-base', 'zebra-stripes'],
  transit: ['transit-line', 'transit-stop'],
  rail: RAIL_LAYERS,
  load: ['macro-flow'],
};

const KEEP: Record<Lens, ReadonlySet<Group>> = {
  all: new Set(['road', 'walk', 'transit', 'rail', 'load']),
  car: new Set(['road']),
  walk: new Set(['walk']),
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

export function applyLens(map: MapLibreMap, lens: Lens): void {
  const keep = KEEP[lens];
  (Object.keys(GROUPS) as Group[]).forEach((g) => {
    GROUPS[g].forEach((layer) => {
      if (lens === 'metro' && g === 'rail' && (layer === 'rail-base' || layer === 'rail-ties' || layer === 'rail-platform')) {
        setOpacity(map, layer, ['case', ['==', ['get', 'kind'], 'subway'], 1, FADED]);
      } else setOpacity(map, layer, keep.has(g) ? 1 : lens === 'load' && g === 'road' ? 0.4 : FADED);
    });
  });
}
