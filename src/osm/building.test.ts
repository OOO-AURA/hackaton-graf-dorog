import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildingCoverage, buildingHeight, heightFromLevels, isBuilding, isBuildingWay, levelsFromHeight } from './building';
import { parseOsm } from './parse';

describe('building tags', () => {
  test('recognises buildings and parts, not roads', () => {
    expect(isBuilding({ building: 'university' })).toBe(true);
    expect(isBuilding({ 'building:part': 'yes' })).toBe(true);
    expect(isBuilding({ building: 'no' })).toBe(false);
    expect(isBuilding({ highway: 'primary' })).toBe(false);
    expect(isBuildingWay({ id: '1', refs: ['a', 'b', 'c', 'a'], tags: { building: 'yes' }, attrs: {} })).toBe(true);
    expect(isBuildingWay({ id: '1', refs: ['a', 'b'], tags: { building: 'yes' }, attrs: {} })).toBe(false);
  });

  test('height comes from the height tag first, then from floors like Webots does', () => {
    expect(buildingHeight({ height: '17.5', 'building:levels': '9' })).toEqual({ metres: 17.5, source: 'height' });
    expect(buildingHeight({ 'building:levels': '4' })).toEqual({ metres: 12, source: 'levels' });
    expect(buildingHeight({ 'building:levels': '4', 'roof:height': '2' })).toEqual({ metres: 14, source: 'levels' });
    expect(buildingHeight({ height: 'abc' })).toEqual({ metres: 9, source: 'default' });
  });

  test('without floors and height Webots uses its defaults per building type', () => {
    expect(buildingHeight({ building: 'house' })).toEqual({ metres: 6, source: 'default' });
    expect(buildingHeight({ building: 'apartments' })).toEqual({ metres: 12, source: 'default' });
    expect(buildingHeight({ building: 'residential' })).toEqual({ metres: 19.2, source: 'default' });
    expect(buildingHeight({ building: 'university' })).toEqual({ metres: 9, source: 'default' });
    expect(buildingHeight({ building: 'residential', 'building:levels': '5' })).toEqual({ metres: 16, source: 'levels' });
  });

  test('converts floors to height and back with the importer rule of 3 m per floor', () => {
    expect(heightFromLevels({ building: 'yes', 'building:levels': '5' }).height).toBe('15');
    expect(heightFromLevels({ building: 'yes' })).toEqual({ building: 'yes' });
    expect(levelsFromHeight({ height: '16,5' })['building:levels']).toBe('5');
    expect(levelsFromHeight({ height: '2' })['building:levels']).toBe('1');
    expect(levelsFromHeight({ height: '20', 'roof:height': '5' })['building:levels']).toBe('5');
  });

  test('coverage on the task example: no building has a height, most have floors', () => {
    const doc = parseOsm(readFileSync(resolve(__dirname, '../test/example.osm'), 'utf8'));
    const c = buildingCoverage(Object.values(doc.ways));
    expect(c.total).toBeGreaterThan(300);
    expect(c.withHeight).toBe(0);
    expect(c.withLevels).toBeGreaterThan(200);
    expect(c.withNothing).toBe(c.total - c.withLevels);
  });
});
