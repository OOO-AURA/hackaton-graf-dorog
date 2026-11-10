import { bearingDeg, curvePoints, distanceM, snapAngle, turnDeg } from './drawGeometry';

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
