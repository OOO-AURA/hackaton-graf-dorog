import {
  buildingHeight, roadLevel, withBuildingHeight, withBuildingLevels, withElevation, withMinHeight, withRoadKind, withRoadLayer,
} from './height';

describe('building heights', () => {
  test('height comes from height, then levels, then a guess', () => {
    expect(buildingHeight({ height: '12.5' }).height).toBe(12.5);
    expect(buildingHeight({ 'building:levels': '4' })).toMatchObject({ height: 12, levels: 4, known: true });
    expect(buildingHeight({ building: 'yes' })).toMatchObject({ height: 9, known: false });
  });

  test('setting metres keeps levels in step, and the other way round', () => {
    expect(withBuildingHeight({ building: 'yes' }, 15)).toMatchObject({ height: '15', 'building:levels': '5' });
    expect(withBuildingLevels({ building: 'yes' }, 9)).toMatchObject({ height: '27', 'building:levels': '9' });
  });

  test('a raised base keeps the top where it was', () => {
    const t = withMinHeight({ building: 'yes', height: '20' }, 6);
    expect(t).toMatchObject({ min_height: '6', height: '20' });
    expect(buildingHeight(t).minHeight).toBe(6);
    expect(withMinHeight(t, 0).min_height).toBeUndefined();
  });

  test('a building is never lower than its base plus a metre', () => {
    expect(withBuildingHeight({ building: 'yes', min_height: '10', height: '20' }, 3).height).toBe('11');
  });
});

describe('road levels', () => {
  test('layer above zero is a bridge, below a tunnel, zero the ground', () => {
    expect(withRoadLayer({ highway: 'primary' }, 2)).toEqual({ highway: 'primary', bridge: 'yes', layer: '2' });
    expect(withRoadLayer({ highway: 'primary', bridge: 'yes', layer: '1' }, -1)).toEqual({ highway: 'primary', tunnel: 'yes', layer: '-1' });
    expect(withRoadLayer({ highway: 'primary', tunnel: 'yes', layer: '-1' }, 0)).toEqual({ highway: 'primary' });
  });

  test('a viaduct stays a viaduct when it is raised', () => {
    expect(withRoadLayer({ highway: 'primary', bridge: 'viaduct', layer: '1' }, 3).bridge).toBe('viaduct');
  });

  test('switching the kind picks the nearest level of that kind', () => {
    expect(roadLevel(withRoadKind({ highway: 'primary' }, 'bridge'))).toEqual({ kind: 'bridge', layer: 1 });
    expect(roadLevel(withRoadKind({ highway: 'primary' }, 'tunnel'))).toEqual({ kind: 'tunnel', layer: -1 });
    expect(roadLevel({ highway: 'primary', bridge: 'yes' })).toEqual({ kind: 'bridge', layer: 1 });
  });

  test('levels are clamped', () => {
    expect(withRoadLayer({}, 40).layer).toBe('5');
  });
});

test('node elevation is written as ele and removed with null', () => {
  expect(withElevation({}, 431.27).ele).toBe('431.3');
  expect(withElevation({ ele: '400' }, null).ele).toBeUndefined();
});
