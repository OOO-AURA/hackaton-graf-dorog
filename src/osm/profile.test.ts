import { describe, expect, it } from 'vitest';
import { capacity, lanesByDirection, normTags, roadProfile, withLaneCount } from './profile';

describe('road profile', () => {
  it('splits lanes by direction', () => {
    expect(lanesByDirection({ highway: 'primary', lanes: '4' })).toEqual({ forward: 2, backward: 2 });
    expect(lanesByDirection({ highway: 'primary', lanes: '2', oneway: 'yes' })).toEqual({ forward: 2, backward: 0 });
    expect(lanesByDirection({ highway: 'residential' })).toEqual({ forward: 1, backward: 1 });
  });
  it('computes capacity of the busier direction', () => {
    expect(capacity({ highway: 'primary', lanes: '4' })).toBe(2400);
    expect(capacity({ highway: 'primary_link', lanes: '1', oneway: 'yes' })).toBe(1200);
    expect(capacity({ highway: 'footway' })).toBe(0);
  });
  it('fills width and speed only when missing', () => {
    expect(normTags({ highway: 'secondary', lanes: '2' })).toMatchObject({ width: '7.0', maxspeed: '60' });
    expect(normTags({ highway: 'secondary', lanes: '2', maxspeed: '40' }).maxspeed).toBe('40');
    expect(roadProfile({ highway: 'living_street' })?.designSpeed).toBe(20);
  });
});

describe('lane counts kept in step', () => {
  const bridge = { highway: 'secondary', lanes: '6', 'lanes:forward': '3', 'lanes:backward': '3' };

  it('a new total shares out over both directions, so the per-direction tags do not override it', () => {
    const t = withLaneCount(bridge, 'lanes', '4');
    expect(t).toMatchObject({ lanes: '4', 'lanes:forward': '2', 'lanes:backward': '2' });
    expect(lanesByDirection(t)).toEqual({ forward: 2, backward: 2 });
    expect(withLaneCount({ ...bridge, 'lanes:forward': '4', 'lanes:backward': '2' }, 'lanes', '3')).toMatchObject({ 'lanes:forward': '2', 'lanes:backward': '1' });
  });

  it('a count for one direction moves the total', () => {
    expect(withLaneCount(bridge, 'lanes:forward', '1')).toMatchObject({ lanes: '4', 'lanes:forward': '1', 'lanes:backward': '3' });
    expect(withLaneCount({ highway: 'primary', lanes: '4' }, 'lanes:backward', '3')).toMatchObject({ lanes: '5', 'lanes:forward': '2', 'lanes:backward': '3' });
  });

  it('leaves one-way roads and untagged splits alone', () => {
    expect(withLaneCount({ highway: 'primary', oneway: 'yes', lanes: '2' }, 'lanes', '3')).toEqual({ highway: 'primary', oneway: 'yes', lanes: '3' });
    expect(withLaneCount({ highway: 'primary', lanes: '2' }, 'lanes', '4')).toEqual({ highway: 'primary', lanes: '4' });
  });

  it('one direction tagged: the other gets what is left of the total', () => {
    expect(lanesByDirection({ highway: 'primary', lanes: '5', 'lanes:forward': '3' })).toEqual({ forward: 3, backward: 2 });
  });
});
