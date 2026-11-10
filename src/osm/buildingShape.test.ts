import {
  area, BUILDING_TEMPLATES, centroid, contains, insertVertex, moveEdge, orientedBox, rectangle, removeVertex, resize, rotate,
  selfIntersects, snapCorner, squareUp, translate, type P,
} from './buildingShape';

const close = (a: P, b: P) => { expect(a[0]).toBeCloseTo(b[0], 6); expect(a[1]).toBeCloseTo(b[1], 6); };

describe('building outlines', () => {
  test('the three templates and nothing else', () => {
    expect(BUILDING_TEMPLATES.map((t) => [t.width, t.length, t.levels])).toEqual([[12, 12, 2], [20, 40, 5], [30, 60, 9]]);
  });

  test('a rectangle knows its size and turn', () => {
    const r = rectangle([10, 20], 20, 40, 30);
    expect(area(r)).toBeCloseTo(800);
    close(centroid(r), [10, 20]);
    const box = orientedBox(r);
    expect(box.width).toBeCloseTo(20);
    expect(box.length).toBeCloseTo(40);
    expect(box.angle).toBeCloseTo(30);
  });

  test('a turn is clockwise like a compass, and half a turn is the same shape', () => {
    const r = rectangle([0, 0], 10, 30, 0);
    expect(orientedBox(rotate(r, 45)).angle).toBeCloseTo(45);
    expect(orientedBox(rotate(r, 180)).angle).toBeCloseTo(0);
  });

  test('resizing keeps the centre and the turn', () => {
    const r = resize(rectangle([5, 5], 20, 40, 60), 10, 50);
    const box = orientedBox(r);
    expect([box.width, box.length, box.angle].map((x) => Math.round(x * 1e6) / 1e6)).toEqual([10, 50, 60]);
    close(box.center, [5, 5]);
  });

  test('a side moves straight out, the rest stays', () => {
    const r = rectangle([0, 0], 10, 10, 0); // corners SW, SE, NE, NW
    const moved = moveEdge(r, 1, [3, 7]); // the east side, dragged diagonally: only 3 m east counts
    expect(area(moved)).toBeCloseTo(130);
    close(moved[0], r[0]);
    close(moved[1], [8, -5]);
  });

  test('a corner dragged near square snaps square, one pulled clearly off stays where it is', () => {
    const r = rectangle([0, 0], 10, 10, 0);
    close(snapCorner(r, 2, [5.3, 4.8], 0.5), [5, 5]);
    close(snapCorner(r, 2, [7, 9], 0.5), [7, 9]);
  });

  test('vertices come and go, never below a triangle', () => {
    const r = rectangle([0, 0], 10, 10, 0);
    const g = insertVertex(r, 1, [5, 0]);
    expect(g).toHaveLength(5);
    expect(removeVertex(removeVertex(g, 2), 0)).toHaveLength(3);
    expect(removeVertex(removeVertex(removeVertex(g, 2), 0), 0)).toHaveLength(3);
  });

  test('squaring up an L shape drawn by hand gives right angles', () => {
    const l: P[] = [[0, 0], [20.4, 0.3], [20.1, 10], [10.2, 9.7], [9.8, 20.2], [0.2, 19.9]];
    const sq = squareUp(l);
    expect(sq).toHaveLength(6);
    sq.forEach((p, i) => {
      const a = sq[(i - 1 + sq.length) % sq.length];
      const b = sq[(i + 1) % sq.length];
      const dot = (a[0] - p[0]) * (b[0] - p[0]) + (a[1] - p[1]) * (b[1] - p[1]);
      expect(Math.abs(dot)).toBeLessThan(1e-6);
    });
  });

  test('squaring drops a point in the middle of a straight side', () => {
    const r: P[] = [[0, 0], [5, 0.1], [10, 0], [10, 10], [0, 10]];
    expect(squareUp(r)).toHaveLength(4);
  });

  test('crossed sides are found; inside and outside are told apart', () => {
    expect(selfIntersects([[0, 0], [10, 10], [10, 0], [0, 10]])).toBe(true);
    expect(selfIntersects(rectangle([0, 0], 10, 20, 15))).toBe(false);
    const r = translate(rectangle([0, 0], 10, 10, 0), [100, 0]);
    expect(contains(r, [101, 2])).toBe(true);
    expect(contains(r, [90, 2])).toBe(false);
  });
});
