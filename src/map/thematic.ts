/**
 * Thematic colouring of roads by one attribute, like the classified link display of PTV Visum.
 * Lane jumps, missing speed limits and capacity bottlenecks become visible on the map at once,
 * instead of clicking road after road.
 */
import { capacity } from '../osm/profile';
import type { Tags } from '../osm/types';

export type RoadColorMode = 'class' | 'lanes' | 'speed' | 'capacity' | 'missing';

export interface Band { readonly label: string; readonly color: string; readonly max: number }

const NO_DATA = '#9A9A9A';

export const THEMATIC: Readonly<Record<Exclude<RoadColorMode, 'class'>, { label: string; prop: string; bands: readonly Band[] }>> = {
  lanes: {
    label: 'Полосы', prop: 'tLanes',
    bands: [{ label: 'не указано', color: NO_DATA, max: 0 }, { label: '1', color: '#5FA3D6', max: 1 }, { label: '2', color: '#3D9F47', max: 2 }, { label: '3', color: '#F0BC2A', max: 3 }, { label: '4', color: '#F09131', max: 4 }, { label: '5+', color: '#E5392A', max: Infinity }],
  },
  speed: {
    label: 'Скорость', prop: 'tSpeed',
    bands: [{ label: 'не указано', color: NO_DATA, max: 0 }, { label: '≤ 20', color: '#B48ADB', max: 20 }, { label: '30–40', color: '#5FA3D6', max: 40 }, { label: '50–60', color: '#3D9F47', max: 60 }, { label: '70–80', color: '#F09131', max: 80 }, { label: '90+', color: '#E5392A', max: Infinity }],
  },
  capacity: {
    label: 'Пропускная, авт/ч', prop: 'tCap',
    bands: [{ label: '< 600', color: '#B48ADB', max: 599 }, { label: '600–1199', color: '#5FA3D6', max: 1199 }, { label: '1200–2399', color: '#3D9F47', max: 2399 }, { label: '2400–3599', color: '#F09131', max: 3599 }, { label: '3600+', color: '#E5392A', max: Infinity }],
  },
  missing: {
    label: 'Пропуски атрибутов', prop: 'tMissing',
    bands: [{ label: 'всё указано', color: '#3D9F47', max: 0 }, { label: 'нет одного: полос или скорости', color: '#F0BC2A', max: 1 }, { label: 'нет ни полос, ни скорости', color: '#E5392A', max: Infinity }],
  },
};

/** Implicit speed limits used in Russia (OSM maxspeed:type values). */
const IMPLICIT_SPEED: Readonly<Record<string, number>> = { 'RU:urban': 60, 'RU:rural': 90, 'RU:living_street': 20, 'RU:motorway': 110 };

export function speedOf(tags: Tags): number {
  const v = tags.maxspeed ?? '';
  if (IMPLICIT_SPEED[v]) return IMPLICIT_SPEED[v];
  const n = Number.parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function lanesOfTag(tags: Tags): number {
  const n = Number.parseInt(tags.lanes ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Feature properties the thematic modes read. */
export function thematicProps(tags: Tags): { tLanes: number; tSpeed: number; tCap: number; tMissing: number } {
  const tLanes = lanesOfTag(tags);
  const tSpeed = speedOf(tags);
  return { tLanes, tSpeed, tCap: capacity(tags), tMissing: Number(!tLanes) + Number(!tSpeed) };
}

/** MapLibre expression that colours by the bands of a mode. */
export function thematicExpression(mode: Exclude<RoadColorMode, 'class'>): unknown {
  const { prop, bands } = THEMATIC[mode];
  const cases = bands.slice(0, -1).flatMap((b) => [['<=', ['get', prop], b.max], b.color]);
  return ['case', ...cases, bands[bands.length - 1].color];
}

export function bandOf(mode: Exclude<RoadColorMode, 'class'>, value: number): Band {
  return THEMATIC[mode].bands.find((b) => value <= b.max)!;
}
