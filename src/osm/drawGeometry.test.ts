import { bearingDeg, curvePoints, distanceM, roundCorners, snapAngle, turnDeg } from './drawGeometry';

const M_LON = 1 / (111_195 * Math.cos((52 * Math.PI) / 180));
const M_LAT = 1 / 111_195;
const at = (x: number, y: number) => ({ lon: 104 + x * M_LON, lat: 52 + y * M_LAT });

describe('drawing geometry', () => {
  test('a turn close to 45° snaps onto it and keeps its length', () => {
    // Heading north, then a segment 43° to the right, 30 m long.
    const a = (43 * Math.PI) / 180;
    const r = snapAngle(at(0, 0), at(30 * Math.sin(a), 30 * Math.cos(a)), 0, false);
    expect(r.snapped).toBe(true);
    expect(r.turn).toBe(45);
    expect(bearingDeg(at(0, 0), r.point)).toBeCloseTo(45, 3);
    expect(distanceM(at(0, 0), r.point)).toBeCloseTo(30, 3);
  });

  test('a free turn stays as drawn unless Shift forces the nearest round angle', () => {
    const a = (52 * Math.PI) / 180;
    const target = at(20 * Math.sin(a), 20 * Math.cos(a));
    expect(snapAngle(at(0, 0), target, 0, false).snapped).toBe(false);
    const forced = snapAngle(at(0, 0), target, 0, true);
    expect(forced.turn).toBe(45);
  });

  test('turns are measured from the segment before, left negative', () => {
    expect(turnDeg(90, 30)).toBe(-60);
    expect(turnDeg(350, 20)).toBe(30);
  });

  test('a curve runs smoothly between its ends, bent towards the control point', () => {
    const pts = curvePoints(at(0, 0), at(0, 40), at(40, 40));
    expect(pts.length).toBeGreaterThan(5);
    // The middle of the curve lies inside the corner, between the straight lines and the control.
    const mid = pts[Math.floor(pts.length / 2)];
    const [x, y] = [(mid.lon - 104) / M_LON, (mid.lat - 52) / M_LAT];
    expect(x).toBeGreaterThan(5);
    expect(y).toBeGreaterThan(20);
    expect(x).toBeLessThan(20);
  });

  test('a control point far ahead and an end beside the start makes a U-turn', () => {
    const pts = curvePoints(at(0, 0), at(5, 60), at(10, 0));
    const ys = pts.map((p) => (p.lat - 52) / M_LAT);
    expect(Math.max(...ys)).toBeGreaterThan(25);
    expect(bearingDeg(pts[pts.length - 2], pts[pts.length - 1])).toBeGreaterThan(140);
  });
});

describe('rounded corners', () => {
  test('a right angle drawn by hand becomes an arc between the two straights', () => {
    const pts = roundCorners([at(0, 0), at(0, 60), at(60, 60)], 15);
    expect(pts.length).toBeGreaterThan(5);
    // The corner point itself is gone; the arc starts 15 m before it and ends 15 m after.
    const xy = pts.map((p) => [(p.lon - 104) / M_LON, (p.lat - 52) / M_LAT]);
    expect(xy.some(([x, y]) => Math.abs(x) < 0.1 && Math.abs(y - 60) < 0.1)).toBe(false);
    expect(xy[1][0]).toBeCloseTo(0, 1);
    expect(xy[1][1]).toBeCloseTo(45, 1);
    expect(xy[xy.length - 2][0]).toBeCloseTo(15, 1);
    // No turn along the result is sharp any more.
    for (let i = 1; i < pts.length - 1; i += 1) {
      expect(Math.abs(turnDeg(bearingDeg(pts[i - 1], pts[i]), bearingDeg(pts[i], pts[i + 1])))).toBeLessThan(20);
    }
  });

  test('points on a node or road stay, and a nearly straight point is left alone', () => {
    const joined = { ...at(0, 60), nodeId: '7' };
    expect(roundCorners([at(0, 0), joined, at(60, 60)], 15)).toContain(joined);
    expect(roundCorners([at(0, 0), at(1, 60), at(0, 120)], 15)).toHaveLength(3);
  });

  test('on short segments the arc is smaller than asked', () => {
    const pts = roundCorners([at(0, 0), at(0, 10), at(10, 10)], 50);
    const first = pts[1];
    expect(distanceM(first, at(0, 10))).toBeLessThanOrEqual(4.6);
  });
});
