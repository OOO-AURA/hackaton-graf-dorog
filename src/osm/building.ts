/**
 * Building attributes that the Webots OSM importer turns into 3D.
 *
 * Webots reads building:levels, height, min_height, roof:shape, roof:height, building:material,
 * roof:material and the colours. Without levels and height it uses the defaults of its config.ini
 * per building type (a house has 2 floors, apartments 4, residential 6 floors of 3.2 m, anything else
 * 3 floors of 3 m), so the 3D scene on the jury video is only as good as these tags.
 */
import { withTag } from './tags';
import type { OsmWay, Tags } from './types';

/** Floor height the Webots importer assumes when it derives floors from height and back. */
export const LEVEL_HEIGHT_M = 3;

/** Webots osm_importer config.ini: floors and floor height per building type. */
const WEBOTS_DEFAULTS: Readonly<Record<string, { floors: number; floorHeight: number }>> = {
  house: { floors: 2, floorHeight: 3 },
  apartments: { floors: 4, floorHeight: 3 },
  residential: { floors: 6, floorHeight: 3.2 },
};
const WEBOTS_FALLBACK = { floors: 3, floorHeight: LEVEL_HEIGHT_M };

export const webotsDefaults = (tags: Tags) => WEBOTS_DEFAULTS[tags.building ?? ''] ?? WEBOTS_FALLBACK;

export const isBuilding = (tags: Tags): boolean => Boolean((tags.building && tags.building !== 'no') || tags['building:part']);

export const isBuildingWay = (way: OsmWay | undefined): way is OsmWay => Boolean(way && isBuilding(way.tags) && way.refs.length >= 4);

/** Roof shapes the importer can build; others fall back to a flat roof. */
export const ROOF_SHAPES: ReadonlyArray<readonly [string, string]> = [
  ['flat', 'Плоская'], ['gabled', 'Двускатная'], ['hipped', 'Вальмовая'], ['pyramidal', 'Шатровая'],
];

export const BUILDING_TYPES: ReadonlyArray<readonly [string, string]> = [
  ['yes', 'Здание'], ['apartments', 'Многоквартирный дом'], ['house', 'Частный дом'], ['university', 'Университет'],
  ['college', 'Колледж'], ['school', 'Школа'], ['kindergarten', 'Детский сад'], ['hospital', 'Больница'],
  ['dormitory', 'Общежитие'], ['commercial', 'Коммерческое'], ['retail', 'Торговое'], ['office', 'Офисы'],
  ['industrial', 'Промышленное'], ['warehouse', 'Склад'], ['garage', 'Гаражи'], ['church', 'Храм'], ['public', 'Общественное'],
];

export const WALL_MATERIALS: ReadonlyArray<readonly [string, string]> = [
  ['brick', 'Кирпич'], ['concrete', 'Бетон'], ['glass', 'Стекло'], ['wood', 'Дерево'], ['plaster', 'Штукатурка'], ['metal', 'Металл'],
];

export const ROOF_MATERIALS: ReadonlyArray<readonly [string, string]> = [
  ['metal', 'Металл'], ['concrete', 'Бетон, мягкая кровля'], ['roof_tiles', 'Черепица'], ['slate', 'Шифер'],
];

const positive = (v: string | undefined): number | null => {
  const n = Number.parseFloat((v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
};

export type HeightSource = 'height' | 'levels' | 'default';

const round1 = (v: number) => Math.round(v * 10) / 10;

/** Height Webots will build, as its importer computes it, and where it comes from; the 3D view uses the same. */
export function buildingHeight(tags: Tags): { metres: number; source: HeightSource } {
  const h = positive(tags.height);
  if (h !== null) return { metres: h, source: 'height' };
  const { floors, floorHeight } = webotsDefaults(tags);
  const roof = positive(tags['roof:height']) ?? 0;
  const levels = positive(tags['building:levels']);
  if (levels !== null) return { metres: round1(Math.floor(levels) * floorHeight + roof), source: 'levels' };
  return { metres: round1(floors * floorHeight + roof), source: 'default' };
}

/** Writes height from floors (floors × the type's floor height + roof) so Webots and the 3D view agree. */
export function heightFromLevels(tags: Tags): Tags {
  const levels = positive(tags['building:levels']);
  if (levels === null) return tags;
  const total = Math.floor(levels) * webotsDefaults(tags).floorHeight + (positive(tags['roof:height']) ?? 0);
  return withTag(tags, 'height', String(Math.round(total * 10) / 10));
}

/** Writes floors from height, rounded down like the importer does. */
export function levelsFromHeight(tags: Tags): Tags {
  const h = positive(tags.height);
  if (h === null) return tags;
  const roof = positive(tags['roof:height']) ?? 0;
  return withTag(tags, 'building:levels', String(Math.max(1, Math.floor((h - roof) / LEVEL_HEIGHT_M))));
}

/** Share of buildings that have a height or floor count; a quick measure of how good the 3D will be. */
export function buildingCoverage(ways: readonly OsmWay[]): { total: number; withHeight: number; withLevels: number; withNothing: number } {
  const buildings = ways.filter(isBuildingWay);
  const withHeight = buildings.filter((w) => positive(w.tags.height) !== null).length;
  const withLevels = buildings.filter((w) => positive(w.tags['building:levels']) !== null).length;
  const withNothing = buildings.filter((w) => buildingHeight(w.tags).source === 'default').length;
  return { total: buildings.length, withHeight, withLevels, withNothing };
}
