import type { Tags } from './types';

/**
 * Railways in standard OSM tags. Tracks are ways with `railway=*` (rail, tram, light_rail,
 * subway, narrow_gauge…), with `service` for sidings and yards, `usage` for main and branch
 * lines, `electrified`, `gauge` and `maxspeed`. Platforms are `railway=platform` (or
 * `public_transport=platform`) ways. Stations are nodes: `railway=station`, `railway=halt` (a stop
 * without a station building) and `railway=tram_stop`, with `public_transport` set to match.
 *
 * MATSim and SUMO on the jury server build road networks and leave tracks out; Webots draws them
 * in 3D. The editor keeps them in the file as they are and lets them be edited.
 */

export const RAIL_LINE_KINDS = ['rail', 'tram', 'light_rail', 'subway', 'narrow_gauge', 'monorail', 'funicular', 'disused', 'abandoned', 'construction'] as const;
const LINE_KINDS = new Set<string>(RAIL_LINE_KINDS);

export const isRailLine = (tags: Tags) => LINE_KINDS.has(tags.railway ?? '');
export const isPlatform = (tags: Tags) => tags.railway === 'platform' || tags.public_transport === 'platform';
/** Tracks and platforms: what the rail inspector edits. */
export const isRailWay = (tags: Tags) => isRailLine(tags) || (isPlatform(tags) && !tags.highway);

export type StationKind = 'station' | 'halt' | 'tram_stop';
const STATION_KINDS = new Set<string>(['station', 'halt', 'tram_stop']);
export const stationKind = (tags: Tags): StationKind | null =>
  STATION_KINDS.has(tags.railway ?? '') ? (tags.railway as StationKind) : tags.public_transport === 'station' && !tags.building ? 'station' : null;

export const RAIL_TYPES: ReadonlyArray<readonly [string, string]> = [
  ['rail', 'Железная дорога'], ['tram', 'Трамвай'], ['light_rail', 'Лёгкое метро'], ['subway', 'Метро'],
  ['narrow_gauge', 'Узкоколейка'], ['disused', 'Не используется'], ['abandoned', 'Разобрана'],
];
export const RAIL_SERVICES: ReadonlyArray<readonly [string, string]> = [
  ['', 'Главный путь'], ['siding', 'Боковой путь'], ['yard', 'Станционный, парковый'], ['spur', 'Подъездной'], ['crossover', 'Съезд между путями'],
];
export const RAIL_USAGES: ReadonlyArray<readonly [string, string]> = [
  ['', 'Не указано'], ['main', 'Магистральная'], ['branch', 'Второстепенная'], ['industrial', 'Промышленная'], ['tourism', 'Туристическая'],
];
export const ELECTRIFIED: ReadonlyArray<readonly [string, string]> = [
  ['', 'Не указано'], ['contact_line', 'Контактная сеть'], ['rail', 'Контактный рельс'], ['no', 'Нет'],
];
export const STATION_TYPES: ReadonlyArray<readonly [StationKind, string]> = [
  ['station', 'Станция'], ['halt', 'Остановочный пункт'], ['tram_stop', 'Трамвайная остановка'],
];

/** Gauge of Russian railways, mm; written for new tracks. */
export const RUSSIAN_GAUGE = '1520';
