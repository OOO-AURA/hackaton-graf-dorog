/**
 * Building attributes that the Webots OSM importer turns into 3D.
 *
 * Webots reads building:levels (3 m per floor), height, min_height, roof:shape, roof:height,
 * building:material, roof:material and the colours. A building without any of them is drawn with
 * the importer's default height, so the 3D scene on the jury video is only as good as these tags.
 */
import { withTag } from './tags';
import type { OsmWay, Tags } from './types';

/** Floor height the Webots importer assumes when it derives floors from height and back. */
export const LEVEL_HEIGHT_M = 3;

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

export type HeightSource = 'height' | 'levels' | 'none';

/** Height the 3D view and Webots will use, and where it comes from. */
export function buildingHeight(tags: Tags): { metres: number | null; source: HeightSource } {
  const h = positive(tags.height);
  if (h !== null) return { metres: h, source: 'height' };
  const levels = positive(tags['building:levels']);
  if (levels !== null) return { metres: levels * LEVEL_HEIGHT_M + (positive(tags['roof:height']) ?? 0), source: 'levels' };
  return { metres: null, source: 'none' };
}

/** Writes height from floors (floors × 3 m + roof) so Webots and the 3D view agree. */
export function heightFromLevels(tags: Tags): Tags {
  const levels = positive(tags['building:levels']);
  if (levels === null) return tags;
  const total = levels * LEVEL_HEIGHT_M + (positive(tags['roof:height']) ?? 0);
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
  const withNothing = buildings.filter((w) => buildingHeight(w.tags).source === 'none').length;
  return { total: buildings.length, withHeight, withLevels, withNothing };
}
