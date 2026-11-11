import { addBuilding, localOutline, metres, type LonLat } from './buildingEdit';
import { area, rectangle } from './buildingShape';
import { isBuilding } from './building';
import { withTag } from './tags';
import type { OsmDoc, OsmWay, Tags } from './types';

/**
 * Car parks in standard OSM tags, so every importer reads the file as before: an area
 * `amenity=parking` with its kind (`parking=surface|multi-storey|underground|rooftop|street_side`),
 * places (`capacity`, `capacity:disabled`), payment (`fee`) and who may park (`access`). A
 * multi-storey car park is also a building (`building=parking` with storeys), so Webots builds it
 * in 3D and the trip model counts it like the buildings around it.
 */

export type ParkingKind = 'surface' | 'multi-storey' | 'underground' | 'rooftop' | 'street_side';

export const PARKING_KINDS: ReadonlyArray<readonly [ParkingKind, string]> = [
  ['surface', 'Открытая площадка'],
  ['street_side', 'Карман у дороги'],
  ['multi-storey', 'Многоуровневый паркинг'],
  ['underground', 'Подземный паркинг'],
  ['rooftop', 'На крыше'],
];

export const PARKING_ACCESS: ReadonlyArray<readonly [string, string]> = [
  ['', 'Не указано'], ['yes', 'Для всех'], ['customers', 'Для посетителей'], ['permissive', 'Пускают, но не обязаны'], ['private', 'Только своим'],
];

export const PARKING_FEE: ReadonlyArray<readonly [string, string]> = [['', 'Не указано'], ['no', 'Бесплатно'], ['yes', 'Платно']];

/** Area of a car park per place with its aisles, m² (СП 42.13330.2016: 25 m² per car on an open lot). */
export const AREA_PER_PLACE = 25;
/** Share of places kept for disabled drivers at public places (СП 59.13330.2020: at least 10 %, at least one). */
export const DISABLED_SHARE = 0.1;
/** Storeys a new multi-storey car park gets. */
export const DEFAULT_PARKING_LEVELS = 3;

/** Length of one place along a road, metres, by how the cars stand. */
export const STREET_PLACE_LENGTH: Readonly<Record<string, number>> = { parallel: 6, diagonal: 3.5, perpendicular: 2.5 };

export const isParkingTags = (tags: Tags): boolean => tags.amenity === 'parking';

/** A car park drawn as an area: a closed way of at least three corners. */
export const isParkingArea = (way: OsmWay | undefined): boolean =>
  Boolean(way && isParkingTags(way.tags) && way.refs.length >= 4 && way.refs[0] === way.refs[way.refs.length - 1]);

/** A closed outline shaped on the map with the same handles: a building or a car park. */
export function isOutlineWay(way: OsmWay | undefined): boolean {
  if (!way) return false;
  const building = isBuilding(way.tags) && way.refs.length >= 4;
  return building || isParkingArea(way);
}

export const parkingKind = (tags: Tags): ParkingKind => {
  const k = tags.parking as ParkingKind | undefined;
  return k && PARKING_KINDS.some(([v]) => v === k) ? k : 'surface';
};

const positiveInt = (v: string | undefined): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && v?.trim() !== '' ? n : null;
};

/** Storeys the places stand on: the building's storeys for a multi-storey car park, else one. */
export function parkingLevels(tags: Tags): number {
  if (parkingKind(tags) !== 'multi-storey') return 1;
  return Math.max(1, positiveInt(tags['building:levels']) ?? DEFAULT_PARKING_LEVELS);
}

/** Places that fit on `areaM2` square metres over `levels` storeys. */
/** Slack for the area worked out from coordinates: 999.97 m² still holds 40 places. */
const AREA_SLACK = 0.01;
export const placesFor = (areaM2: number, levels = 1): number => Math.max(0, Math.floor((areaM2 / AREA_PER_PLACE) * levels + AREA_SLACK));

/** Places to keep for disabled drivers out of `places`. */
export const disabledFor = (places: number): number => (places > 0 ? Math.max(1, Math.ceil(places * DISABLED_SHARE)) : 0);

export interface ParkingInfo {
  readonly areaM2: number;
  readonly levels: number;
  /** Places by the area. */
  readonly estimate: number;
  /** Places as tagged, or null. */
  readonly capacity: number | null;
  readonly disabled: number | null;
  /** Fewer places for disabled drivers than the rules ask. */
  readonly disabledShort: boolean;
}

export function parkingInfo(doc: OsmDoc, wayId: string): ParkingInfo | null {
  const way = doc.ways[wayId];
  const local = localOutline(doc, wayId);
  if (!way || !local) return null;
  const areaM2 = area(local.ring);
  const levels = parkingLevels(way.tags);
  const capacity = positiveInt(way.tags.capacity);
  const disabled = positiveInt(way.tags['capacity:disabled']);
  const places = capacity ?? placesFor(areaM2, levels);
  return { areaM2, levels, estimate: placesFor(areaM2, levels), capacity, disabled, disabledShort: places > 0 && (disabled ?? 0) < disabledFor(places) };
}

/**
 * Changes the kind of a car park. A multi-storey one becomes a building of its own with storeys;
 * leaving that kind takes the building tags away again, but only the ones this set.
 */
export function withParkingKind(tags: Tags, kind: ParkingKind): Tags {
  let t = withTag(tags, 'parking', kind);
  if (kind === 'multi-storey') {
    if (!t.building) t = withTag(t, 'building', 'parking');
    if (!t['building:levels']) t = withTag(t, 'building:levels', String(DEFAULT_PARKING_LEVELS));
  } else if (t.building === 'parking') {
    t = withTag(withTag(t, 'building', null), 'building:levels', null);
  }
  return t;
}

/**
 * Changes the kind of a car park of `areaM2` square metres. Places counted by the area follow the
 * new number of storeys; places someone typed in are kept.
 */
export function retagKind(tags: Tags, kind: ParkingKind, areaM2: number): Tags {
  const next = withParkingKind(tags, kind);
  const counted = !tags.capacity || tags.capacity === String(placesFor(areaM2, parkingLevels(tags)));
  return counted ? withTag(next, 'capacity', String(placesFor(areaM2, parkingLevels(next)))) : next;
}

/** Sets the storeys of a multi-storey car park; places counted by the area follow them. */
export function retagLevels(tags: Tags, levels: number, areaM2: number): Tags {
  if (!Number.isInteger(levels) || levels < 1) return tags;
  const next = withTag(tags, 'building:levels', String(levels));
  const counted = !tags.capacity || tags.capacity === String(placesFor(areaM2, parkingLevels(tags)));
  return counted ? withTag(next, 'capacity', String(placesFor(areaM2, parkingLevels(next)))) : next;
}

/** Writes the places of a car park; an empty or wrong value removes the tag. */
export function withCapacity(tags: Tags, key: 'capacity' | 'capacity:disabled', value: string): Tags {
  const n = positiveInt(value);
  return withTag(tags, key, n === null ? null : String(n));
}

/** Sizes of the car parks the tool puts, metres. */
export interface ParkingTemplate { readonly id: string; readonly label: string; readonly width: number; readonly length: number }

export const PARKING_TEMPLATES: readonly ParkingTemplate[] = [
  { id: 'yard', label: 'Во дворе', width: 12, length: 25 },
  { id: 'lot', label: 'Стоянка', width: 25, length: 40 },
  { id: 'mall', label: 'У ТЦ', width: 45, length: 60 },
];

/** Tags of a new open car park: free and open to all, places by its area. */
export const parkingTemplateTags = (t: ParkingTemplate): Tags => ({
  amenity: 'parking', parking: 'surface', access: 'yes', fee: 'no', capacity: String(placesFor(t.width * t.length)),
});

/** Puts a new car park from a template at `center`, its long side on bearing `angle`. */
export function placeParking(doc: OsmDoc, center: LonLat, t: ParkingTemplate, angle: number): { doc: OsmDoc; id: string } {
  const m = metres(center[1]);
  return addBuilding(doc, rectangle(m.to(center), t.width, t.length, angle).map(m.back), parkingTemplateTags(t));
}

/** Places along a road with parking at its sides, by the tags of the new street-parking scheme or the old one. */
export function streetPlaces(tags: Tags, lengthM: number): number {
  const sides = (['left', 'right'] as const).map((side) => {
    const value = tags[`parking:${side}`] ?? tags['parking:both'] ?? tags[`parking:lane:${side}`] ?? tags['parking:lane:both'];
    if (!value || value === 'no' || value === 'separate') return 0;
    const orientation = tags[`parking:${side}:orientation`] ?? tags['parking:both:orientation'] ?? (['parallel', 'diagonal', 'perpendicular'].includes(value) ? value : 'parallel');
    return Math.floor(lengthM / (STREET_PLACE_LENGTH[orientation] ?? STREET_PLACE_LENGTH.parallel));
  });
  return sides[0] + sides[1];
}
