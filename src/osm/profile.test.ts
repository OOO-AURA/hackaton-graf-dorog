import { describe, expect, it } from 'vitest';
import { capacity, lanesByDirection, normTags, roadProfile } from './profile';

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
