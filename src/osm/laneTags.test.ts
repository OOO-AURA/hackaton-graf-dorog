import { laneInfo, laneValue, setLanePsv, setLaneTurns, setLaneValue } from './laneTags';

describe('one lane of a road', () => {
  const road = { highway: 'primary', lanes: '4' };

  test('a turn set on one lane keeps the other lanes as they were', () => {
    const t = setLaneTurns({ ...road, 'turn:lanes:forward': 'left|through' }, 'forward', 1, ['through', 'right']);
    expect(t['turn:lanes:forward']).toBe('left|through;right');
    expect(laneInfo(t, 'forward', 0).turns).toEqual(['left']);
  });

  test('a width on one lane writes the tag for that direction only', () => {
    const t = setLaneValue(road, 'width:lanes', 'backward', 0, '3.25');
    expect(t['width:lanes:backward']).toBe('3.25|');
    expect(t['width:lanes:forward']).toBeUndefined();
    expect(laneValue(t, 'width:lanes', 'backward', 0)).toBe('3.25');
  });

  test('a lane given to buses and taxis and back again leaves no tag behind', () => {
    const on = setLanePsv({ highway: 'primary', oneway: 'yes', lanes: '3' }, 'forward', 2, true);
    expect(on['psv:lanes']).toBe('yes|yes|designated');
    expect(laneInfo(on, 'forward', 2).psv).toBe(true);
    const off = setLanePsv(on, 'forward', 2, false);
    expect(off['psv:lanes']).toBeUndefined();
  });

  test('a lane that does not exist is not written', () => {
    expect(setLaneValue(road, 'maxspeed:lanes', 'forward', 5, '40')).toBe(road);
  });
});
