import type { Tags } from './types';

/** Highway values that carry motor traffic; these make up the road graph for MatSim/SUMO. */
export const DRIVABLE_HIGHWAYS = [
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
  'living_street', 'service', 'road',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
] as const;

const DRIVABLE = new Set<string>(DRIVABLE_HIGHWAYS);

export const isDrivable = (tags: Tags) => DRIVABLE.has(tags.highway ?? '') && tags.area !== 'yes';

export type Direction = 'both' | 'forward' | 'backward';

/** Direction of travel relative to the way's node order, per OSM oneway rules. */
export function direction(tags: Tags): Direction {
  const oneway = tags.oneway;
  if (oneway === '-1' || oneway === 'reverse') return 'backward';
  if (oneway === 'yes' || oneway === '1' || oneway === 'true') return 'forward';
  if (oneway === 'no') return 'both';
  const impliedOneway = tags.junction === 'roundabout' || tags.junction === 'circular' || tags.highway === 'motorway';
  return impliedOneway ? 'forward' : 'both';
}

const SWAP_SUFFIX: ReadonlyArray<[string, string]> = [[':forward', ':backward'], [':left', ':right']];

function swapKey(key: string): string {
  for (const [a, b] of SWAP_SUFFIX) {
    if (key.endsWith(a)) return key.slice(0, -a.length) + b;
    if (key.endsWith(b)) return key.slice(0, -b.length) + a;
  }
  return key;
}

/** Tags of a way after its node order is reversed, so that the meaning on the ground stays the same. */
export function reverseWayTags(tags: Tags): Tags {
  const swapped = Object.fromEntries(Object.entries(tags).map(([k, v]) => [swapKey(k), v]));
  if (swapped.oneway === '-1') return { ...swapped, oneway: 'yes' };
  return swapped;
}

/** Tags of a way after its direction is flipped on the ground (node order kept): yes ↔ -1. */
export function flipOneway(tags: Tags): Tags {
  const dir = direction(tags);
  if (dir === 'both') return tags;
  return { ...tags, oneway: dir === 'forward' ? '-1' : 'yes' };
}

export function withTag(tags: Tags, key: string, value: string | null): Tags {
  if (value === null || value === '') {
    const { [key]: _removed, ...rest } = tags;
    return rest;
  }
  return { ...tags, [key]: value };
}

export const HIGHWAY_COLORS: Readonly<Record<string, string>> = {
  motorway: '#e03131', trunk: '#e8590c', primary: '#f08c00', secondary: '#fab005', tertiary: '#94d82d',
  unclassified: '#4dabf7', residential: '#74c0fc', living_street: '#b197fc', service: '#adb5bd', road: '#adb5bd',
};

export function highwayColor(highway: string): string {
  return HIGHWAY_COLORS[highway.replace(/_link$/, '')] ?? '#adb5bd';
}

export interface RoadTemplate {
  readonly label: string;
  readonly tags: Tags;
}

/** Ready-made attribute sets for new roads (hotkeys 1–6 in the UI). */
export const ROAD_TEMPLATES: readonly RoadTemplate[] = [
  { label: 'Магистраль 2+2', tags: { highway: 'primary', lanes: '4', maxspeed: '60', surface: 'asphalt' } },
  { label: 'Улица 1+1', tags: { highway: 'secondary', lanes: '2', maxspeed: '60', surface: 'asphalt' } },
  { label: 'Жилая', tags: { highway: 'residential', lanes: '2', maxspeed: '40', surface: 'asphalt' } },
  { label: 'Односторонняя', tags: { highway: 'tertiary', lanes: '2', oneway: 'yes', maxspeed: '40', surface: 'asphalt' } },
  { label: 'Съезд', tags: { highway: 'primary_link', lanes: '1', oneway: 'yes', maxspeed: '40', surface: 'asphalt' } },
  { label: 'Проезд', tags: { highway: 'service', maxspeed: '20' } },
  { label: 'Ж/д путь', tags: { railway: 'rail', gauge: '1520', electrified: 'contact_line' } },
  { label: 'Трамвайный путь', tags: { railway: 'tram', gauge: '1524', electrified: 'contact_line' } },
];
