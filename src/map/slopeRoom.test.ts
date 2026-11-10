import { BandIndex, slopeReach, type RoadBand } from './slopeRoom';

describe('room for an embankment slope', () => {
  // An approach running east along y = 0, 10 m wide, and a ramp alongside it 12 m to the north.
  const approach: RoadBand = { a: [0, 0], b: [100, 0], half: 5, way: 'approach' };
  const ramp: RoadBand = { a: [0, 12], b: [100, 12], half: 3.5, way: 'ramp' };
  const index = new BandIndex([approach, ramp]);

  test('with nothing beside the road the slope runs out its full length', () => {
    expect(slopeReach(index, 'approach', [50, 0], [0, -1], 5, 12.5)).toBe(12.5);
  });

  test('the slope stops where the neighbouring road begins', () => {
    const reach = slopeReach(index, 'approach', [50, 0], [0, 1], 5, 12.5);
    expect(reach).toBeGreaterThanOrEqual(8);
    expect(reach).toBeLessThanOrEqual(9);
  });

  test('a road touching the edge leaves no slope: a retaining wall', () => {
    const tight = new BandIndex([approach, { a: [0, 8], b: [100, 8], half: 3.5, way: 'ramp' }]);
    expect(slopeReach(tight, 'approach', [50, 0], [0, 1], 5, 12.5)).toBe(5);
  });

  test('the road itself does not count as being in the way', () => {
    const bend = new BandIndex([approach, { a: [50, 0], b: [50, 30], half: 5, way: 'approach' }]);
    expect(slopeReach(bend, 'approach', [40, 0], [0, 1], 5, 12.5)).toBe(12.5);
  });
});
