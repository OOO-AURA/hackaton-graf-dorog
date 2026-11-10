import { parseOsm } from './parse';
import { buildingConflicts, cutBuildings, demolishBuildings } from './clearance';

/**
 * Two 40 × 40 m buildings side by side around 104 E, 52 N: A (way 10) west, B (way 20) east.
 * A road drawn north to south through the middle of A cuts it in two; B stays clear.
 */
const M_LON = 1 / (111_320 * Math.cos((52 * Math.PI) / 180));
const M_LAT = 1 / 111_320;
const square = (id: number, x0: number) => {
  const pts = [[x0, 0], [x0 + 40, 0], [x0 + 40, 40], [x0, 40]];
  const nodes = pts.map(([x, y], i) => `<node id="${id + i + 1}" lat="${52 + y * M_LAT}" lon="${104 + x * M_LON}"/>`).join('');
  const refs = [1, 2, 3, 4, 1].map((i) => `<nd ref="${id + i}"/>`).join('');
  return { nodes, way: `<way id="${id}">${refs}<tag k="building" v="apartments"/><tag k="building:levels" v="5"/></way>` };
};
const a = square(10, 0);
const b = square(20, 60);
const doc = parseOsm(`<osm version="0.6">${a.nodes}${b.nodes}${a.way}${b.way}</osm>`);
/** The road: from 20 m north of A down to 20 m south of it, along x = 20 m. */
const road = [
  { lon: 104 + 20 * M_LON, lat: 52 + 60 * M_LAT },
  { lon: 104 + 20 * M_LON, lat: 52 - 20 * M_LAT },
];
const WIDTH = 7;

const ringArea = (d: typeof doc, wayId: string) => {
  const w = d.ways[wayId];
  const pts = w.refs.map((r) => [(d.nodes[r].lon - 104) / M_LON, (d.nodes[r].lat - 52) / M_LAT]);
  return Math.abs(pts.slice(1).reduce((s, p, i) => s + pts[i][0] * p[1] - p[0] * pts[i][1], 0)) / 2;
};

describe('roads through buildings', () => {
  test('a road through a building finds that building and leaves its neighbour', () => {
    const hits = buildingConflicts(doc, road, WIDTH);
    expect(hits.map((h) => h.wayId)).toEqual(['10']);
    // The corridor is the carriageway with a metre on each side: 9 m across 40 m of building.
    expect(hits[0].overlap).toBeGreaterThan(300);
    expect(hits[0].overlap).toBeLessThan(400);
  });

  test('a road along a building, clear of it, finds nothing', () => {
    const beside = road.map((p) => ({ ...p, lon: p.lon + 30 * M_LON }));
    expect(buildingConflicts(doc, beside, WIDTH)).toEqual([]);
  });

  test('cutting splits the building along the road, keeping its tags on both parts', () => {
    const cut = cutBuildings(doc, ['10'], road, WIDTH);
    const parts = Object.values(cut.ways).filter((w) => w.tags.building === 'apartments' && w.id !== '20');
    expect(parts).toHaveLength(2);
    expect(parts.every((w) => w.tags['building:levels'] === '5')).toBe(true);
    const total = parts.reduce((s, w) => s + ringArea(cut, w.id), 0);
    expect(total).toBeGreaterThan(1600 - 400);
    expect(total).toBeLessThan(1600 - 300);
    expect(buildingConflicts(cut, road, WIDTH)).toEqual([]);
    // The old corner nodes went with the old outline.
    expect(cut.nodes['11']).toBeUndefined();
  });

  test('a sliver left after the cut is dropped instead of kept as a building', () => {
    const edge = road.map((p) => ({ ...p, lon: p.lon + 17 * M_LON }));
    const cut = cutBuildings(doc, ['10'], edge, 6);
    const parts = Object.values(cut.ways).filter((w) => w.tags.building && w.id !== '20');
    expect(parts.every((w) => ringArea(cut, w.id) > 20)).toBe(true);
  });

  test('demolishing removes the building and its nodes', () => {
    const d = demolishBuildings(doc, ['10']);
    expect(d.ways['10']).toBeUndefined();
    expect(d.nodes['11']).toBeUndefined();
    expect(d.ways['20']).toBeDefined();
  });
});
