import { describe, expect, it } from 'vitest';
import { kindOf, unitOutlines, vehiclePoses, vehicleShapes } from './poses';
import type { SimFrame, SimResult } from './types';

const M = (Math.PI / 180) * 6_371_000;
const LAT = 52.26;
const KX = M * Math.cos((LAT * Math.PI) / 180);
const TYPES = ['car', 'van', 'truck', 'trailer', 'bus', 'bus18', 'ptbus', 'ped'];

/** One vehicle of `type` at points given in metres east and north, a frame a second. */
function run(type: number, path: Array<[number, number, number]>): SimResult {
  const frames: SimFrame[] = path.map(([e, n, angle], t) => ({ t, v: [0, 104.26 + e / KX, LAT + n / M, angle, 10, type] }));
  return { frames, types: TYPES } as unknown as SimResult;
}

describe('vehicle poses', () => {
  it('maps SUMO types to models', () => {
    expect(['car', 'van', 'truck', 'trailer', 'bus', 'bus18', 'ptbus', 'ped', 'other'].map(kindOf))
      .toEqual(['car', 'van', 'truck', 'semi', 'bus', 'bus', 'bus', 'pedestrian', 'car']);
  });

  it('interpolates the position and turns the short way round', () => {
    const r = run(0, [[0, 0, 350], [10, 0, 10]]);
    const [p] = vehiclePoses(r, 0.5);
    expect((p.lon - 104.26) * KX).toBeCloseTo(5, 3);
    expect(p.angle).toBeCloseTo(360, 3);
  });

  it('keeps a semi straight on a straight road', () => {
    const r = run(3, Array.from({ length: 6 }, (_, i) => [0, i * 10, 0] as [number, number, number]));
    expect(vehiclePoses(r, 5)[0].bend).toBeCloseTo(0, 3);
  });

  it('bends the trailer of a semi turning right to the left of the tractor', () => {
    // North for 40 m, then a right turn: heading east now.
    const r = run(3, [[0, 0, 0], [0, 10, 0], [0, 20, 0], [0, 30, 0], [0, 40, 0], [6, 46, 60], [14, 48, 90]]);
    const p = vehiclePoses(r, 6)[0];
    expect(p.kind).toBe('semi');
    expect(p.bend).toBeGreaterThan(0.3);
    expect(p.bend).toBeLessThan(1.5);
  });

  it('outlines a semi as two units and draws one polygon each', () => {
    const units = unitOutlines({ kind: 'semi', angle: 90, bend: 0 });
    expect(units).toHaveLength(2);
    const xs = units.flat().map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(-16.5, 1);
    expect(Math.max(...xs)).toBeCloseTo(0, 3);
    expect(unitOutlines({ kind: 'tram', angle: 0, bend: 0.2 })).toHaveLength(3);
    const shapes = vehicleShapes([{ kind: 'car', lon: 104.26, lat: LAT, angle: 0, bend: 0, kmh: 30 }]);
    expect(shapes.features).toHaveLength(1);
    expect(shapes.features[0].geometry.coordinates[0]).toHaveLength(5);
  });
});
