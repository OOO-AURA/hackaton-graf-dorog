import { canHavePsvLane, hasPsvLane, psvLanes, setPsvLane, travels } from './busLanes';

describe('lanes for route vehicles and taxis', () => {
  test('on a one-way road the rightmost lane is given to buses and taxis', () => {
    const t = setPsvLane({ highway: 'primary', oneway: 'yes', lanes: '3' }, 'forward', true);
    expect(t['psv:lanes']).toBe('yes|yes|designated');
    expect([...psvLanes(t, 'forward')]).toEqual([2]);
  });

  test('on a two-way road each direction has its own lane, and taking it back clears the tag', () => {
    const base = { highway: 'primary', lanes: '4' };
    const both = setPsvLane(setPsvLane(base, 'forward', true), 'backward', true);
    expect(both).toMatchObject({ 'psv:lanes:forward': 'yes|designated', 'psv:lanes:backward': 'yes|designated' });
    const one = setPsvLane(both, 'backward', false);
    expect(one['psv:lanes:backward']).toBeUndefined();
    expect(hasPsvLane(one, 'forward')).toBe(true);
    expect(hasPsvLane(one, 'backward')).toBe(false);
  });

  test('a direction of one lane cannot give it away', () => {
    const t = { highway: 'residential', lanes: '2' };
    expect(canHavePsvLane(t, 'forward')).toBe(false);
    expect(setPsvLane(t, 'forward', true)).toBe(t);
  });

  test('bus:lanes from OSM counts too, and a reversed one-way road travels backward', () => {
    expect([...psvLanes({ highway: 'primary', oneway: 'yes', lanes: '2', 'bus:lanes': 'yes|designated' }, 'forward')]).toEqual([1]);
    expect(travels({ highway: 'primary', oneway: '-1', lanes: '2' })).toEqual(['backward']);
    expect(travels({ highway: 'primary', lanes: '4' })).toEqual(['forward', 'backward']);
  });
});
