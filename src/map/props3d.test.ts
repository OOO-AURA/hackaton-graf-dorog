import { describe, expect, it } from 'vitest';
import { addSign, addTrafficLight, addVehicle, VEHICLE_KINDS, VEHICLE_SIZE, type P2 } from './props3d';

const STRIDE = 12;
function collect(write: (out: { push(...v: number[]): void }) => void) {
  const data: number[] = [];
  write({ push: (...v) => { data.push(...v); } });
  const pts: [number, number, number][] = [];
  for (let i = 0; i < data.length; i += STRIDE) pts.push([data[i], data[i + 1], data[i + 2]]);
  return { data, pts };
}
const extent = (pts: [number, number, number][], k: 0 | 1 | 2) => {
  const v = pts.map((p) => p[k]);
  return [Math.min(...v), Math.max(...v)];
};

describe('vehicle models', () => {
  it.each(VEHICLE_KINDS)('%s has its real length, width and height', (kind) => {
    const { pts } = collect((out) => addVehicle(out, kind, [0, 0], [1, 0]));
    const size = VEHICLE_SIZE[kind];
    const [x0, x1] = extent(pts, 0);
    const [y0, y1] = extent(pts, 1);
    const [, z1] = extent(pts, 2);
    expect(x1).toBeCloseTo(0, 1); // front bumper at the given point
    expect(x1 - x0).toBeCloseTo(size.length, 1);
    expect(y1 - y0).toBeCloseTo(size.width, 1);
    // Trolley poles and the pantograph reach above the body height.
    if (kind !== 'trolleybus' && kind !== 'tram') expect(z1).toBeCloseTo(size.height, 1);
    else expect(z1).toBeGreaterThan(size.height);
  });

  it('stays very low-poly', () => {
    for (const kind of VEHICLE_KINDS) {
      const { pts } = collect((out) => addVehicle(out, kind, [0, 0], [1, 0]));
      expect(pts.length / 3).toBeLessThan(260);
    }
  });

  it('turns with its heading and bends a semi at the hitch', () => {
    const north: P2 = [0, -1];
    const { pts } = collect((out) => addVehicle(out, 'car', [10, 10], north));
    const [y0, y1] = extent(pts, 1);
    expect(y0).toBeCloseTo(10, 1);
    expect(y1).toBeCloseTo(14.5, 1);
    const straight = collect((out) => addVehicle(out, 'semi', [0, 0], [1, 0]));
    const bent = collect((out) => addVehicle(out, 'semi', [0, 0], [1, 0], 0.4));
    // The trailer's heading turns left, so its rear swings out to the right (south when heading east).
    expect(extent(bent.pts, 1)[1]).toBeGreaterThan(extent(straight.pts, 1)[1] + 2);
  });
});

describe('signs and lights', () => {
  it('a sign faces the drivers coming towards it', () => {
    // Traffic goes east, so the face (lit side) looks west: its plates lie west of the pole.
    const { pts } = collect((out) => addSign(out, 'give_way', [0, 0], [1, 0]));
    expect(extent(pts, 0)[0]).toBeLessThan(-0.04);
    expect(extent(pts, 2)[1]).toBeGreaterThan(2.3);
  });

  it('a cantilever reaches over the road on the right of the pole', () => {
    // Traffic goes east with the pole on its right (south); the arm reaches north over the road.
    const { pts } = collect((out) => addTrafficLight(out, [0, 0], [1, 0], 6));
    expect(extent(pts, 1)[0]).toBeLessThan(-5.5);
    expect(extent(pts, 2)[1]).toBeGreaterThan(6);
  });
});
