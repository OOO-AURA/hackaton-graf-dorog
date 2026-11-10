import { cutLines, lightPosition } from './scene3d';

describe('3D cutaway', () => {
  const mask = (w: number, h: number, marks: Array<[number, number, number]>) => {
    const p = new Uint8Array(w * h * 4);
    for (const [x, y, id] of marks) {
      const i = (y * w + x) * 4;
      p[i] = id % 256; p[i + 1] = Math.floor(id / 256) % 256; p[i + 2] = Math.floor(id / 65536); p[i + 3] = 255;
    }
    return p;
  };

  test('each building is cut at the lowest road pixel it hides', () => {
    const rows = cutLines(mask(4, 6, [[0, 4, 1], [3, 2, 1], [1, 5, 2]]), 4, 6, 3);
    expect(rows[1]).toBe(2);
    expect(rows[2]).toBe(5);
    expect(rows[3]).toBe(-1);
  });

  test('building numbers past 255 survive the colour encoding', () => {
    expect(cutLines(mask(2, 2, [[1, 1, 70000]]), 2, 2, 70000)[70000]).toBe(1);
  });

  test('the light turns with the map', () => {
    const [x0, y0, z0] = lightPosition(0);
    const [x1, y1, z1] = lightPosition(90);
    expect(z1).toBeCloseTo(z0);
    expect(Math.hypot(x1, y1)).toBeCloseTo(Math.hypot(x0, y0));
    expect(x1).not.toBeCloseTo(x0);
  });
});
