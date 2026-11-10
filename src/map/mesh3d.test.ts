import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseOsm } from '../osm/parse';
import { bridgeHeight, buildingGroups, deckBottom, parapetAt, buildScene3d, TUNNEL_PROFILE, deckProfile, LANE_WIDTH, LAYER_HEIGHT, roadWidth, STRIDE, type Scene3dColors } from './mesh3d';

const COLORS: Scene3dColors = {
  building: [0.8, 0.7, 0.6], deck: () => [1, 0.8, 0], deckSide: [0.5, 0.4, 0.3], parapet: [0.9, 0.9, 0.9], embankment: [0.4, 0.45, 0.3], mark: [1, 1, 1], markCasing: [0, 0, 0], pier: [0.5, 0.4, 0.3], portal: [0.5, 0.4, 0.3],
};

const osm = (body: string) => parseOsm(`<osm version="0.6">${body}</osm>`);

/** A 20 × 20 m square building around 104 E, 52 N. */
const SQUARE = `
  <node id="1" lat="52.00000" lon="104.00000"/>
  <node id="2" lat="52.00000" lon="104.00029"/>
  <node id="3" lat="52.00018" lon="104.00029"/>
  <node id="4" lat="52.00018" lon="104.00000"/>`;

const zOf = (data: Float32Array, stride: number) => Array.from({ length: data.length / stride }, (_, i) => data[i * stride + 2]);

describe('3D scene geometry', () => {
  test('a building is four walls and a roof at its height', () => {
    const doc = osm(`${SQUARE}<way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><nd ref="1"/><tag k="building" v="yes"/><tag k="building:levels" v="5"/></way>`);
    const mesh = buildScene3d(doc, COLORS)!;
    // 4 walls × 2 triangles + 2 roof triangles, 3 vertices each.
    expect(mesh.solid.length / STRIDE).toBe((4 * 2 + 2) * 3);
    const z = zOf(mesh.solid, STRIDE);
    expect(Math.max(...z)).toBe(15);
    expect(Math.min(...z)).toBe(0);
    // Every vertex carries the number of its building.
    expect(mesh.buildings).toBe(1);
    for (let i = 0; i < mesh.solid.length / STRIDE; i += 1) expect(mesh.solid[i * STRIDE + 6]).toBe(1);
  });

  test('roof normals point up, wall normals point inwards as MapLibre lights them', () => {
    const doc = osm(`${SQUARE}<way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><nd ref="1"/><tag k="building" v="yes"/><tag k="height" v="10"/></way>`);
    const { solid } = buildScene3d(doc, COLORS)!;
    const verts = Array.from({ length: solid.length / STRIDE }, (_, i) => solid.slice(i * STRIDE, (i + 1) * STRIDE));
    const cx = verts.reduce((s, v) => s + v[0], 0) / verts.length;
    const cy = verts.reduce((s, v) => s + v[1], 0) / verts.length;
    for (let t = 0; t < verts.length; t += 3) {
      const [a, b, c] = verts.slice(t, t + 3);
      const n = [a[7], a[8], a[9]];
      if (a[2] === 10 && b[2] === 10 && c[2] === 10) expect(n[2]).toBeCloseTo(1);
      else {
        const mx = (a[0] + b[0] + c[0]) / 3 - cx;
        const my = (a[1] + b[1] + c[1]) / 3 - cy;
        expect(n[0] * mx + n[1] * my).toBeLessThan(0);
      }
    }
  });

  test('touching sections of a block share one number, a building apart gets its own', () => {
    const sq = (x: number, y: number, s = 10): Array<[number, number]> => [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]];
    const groups = buildingGroups([
      { refs: ['a1', 'a2', 'a3', 'a4', 'a1'], pts: sq(0, 0) },
      // Shares no node, but its corner lies on the first one's wall.
      { refs: ['b1', 'b2', 'b3', 'b4', 'b1'], pts: sq(10.2, 3) },
      // Shares a node with the second.
      { refs: ['b2', 'c2', 'c3', 'c4', 'b2'], pts: sq(20, 3) },
      { refs: ['d1', 'd2', 'd3', 'd4', 'd1'], pts: sq(100, 100) },
    ]);
    expect(groups[0]).toBe(groups[1]);
    expect(groups[1]).toBe(groups[2]);
    expect(groups[3]).not.toBe(groups[0]);
  });

  test('min_height lifts the base of a building', () => {
    const doc = osm(`${SQUARE}<way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><nd ref="1"/><tag k="building" v="roof"/><tag k="height" v="8"/><tag k="min_height" v="5"/></way>`);
    expect(Math.min(...zOf(buildScene3d(doc, COLORS)!.solid, STRIDE))).toBe(5);
  });

  test('positions are local metres around the origin', () => {
    const doc = osm(`${SQUARE}<way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><nd ref="1"/><tag k="building" v="yes"/></way>`);
    const { solid } = buildScene3d(doc, COLORS)!;
    const xs = Array.from({ length: solid.length / STRIDE }, (_, i) => solid[i * STRIDE]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(20, 0);
  });

  test('road widths come from width, then lanes', () => {
    expect(roadWidth({ width: '9' })).toBe(9);
    expect(roadWidth({ lanes: '3' })).toBe(3 * LANE_WIDTH);
    expect(roadWidth({ oneway: 'yes' })).toBe(LANE_WIDTH);
    expect(roadWidth({})).toBe(2 * LANE_WIDTH);
  });

  test('bridge height follows the OSM layer', () => {
    expect(bridgeHeight({})).toBe(LAYER_HEIGHT);
    expect(bridgeHeight({ layer: '2' })).toBe(2 * LAYER_HEIGHT);
  });

  test('a bridge deck starts and ends on the ground and is level in the middle', () => {
    const z = deckProfile([0, 10, 20, 30, 60, 90, 100, 110, 120], 5);
    expect(z[0]).toBe(0);
    expect(z[z.length - 1]).toBe(0);
    expect(z[4]).toBe(5);
    expect(z[1]).toBeGreaterThan(0);
    expect(z[1]).toBeLessThan(z[3]);
  });

  test('ground roads go to the cutaway mask, bridges too, tunnels do not', () => {
    const nodes = `
      <node id="1" lat="52.0" lon="104.000"/><node id="2" lat="52.0" lon="104.002"/>
      <node id="3" lat="52.0" lon="104.004"/><node id="4" lat="52.0" lon="104.006"/>`;
    const ground = buildScene3d(osm(`${nodes}<way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="primary"/></way>`), COLORS)!;
    expect(ground.roadMask.length / 3).toBe(6);
    expect(ground.structures.length).toBe(0);
    const bridge = buildScene3d(osm(`${nodes}<way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><tag k="highway" v="primary"/><tag k="bridge" v="yes"/></way>`), COLORS)!;
    expect(bridge.roadMask.length).toBeGreaterThan(0);
    expect(bridge.structures.length).toBeGreaterThan(0);
    const tunnel = buildScene3d(osm(`${nodes}<way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="primary"/><tag k="tunnel" v="yes"/></way>`), COLORS)!;
    expect(tunnel.roadMask.length).toBe(0);
  });

  test('a bridge of two points still rises to its level, and the level changes its height', () => {
    const nodes = `<node id="1" lat="52.0" lon="104.000"/><node id="2" lat="52.0" lon="104.003"/>`;
    const top = (layer: string) => {
      const m = buildScene3d(osm(`${nodes}<way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="primary"/><tag k="bridge" v="yes"/><tag k="layer" v="${layer}"/></way>`), COLORS)!;
      return Math.max(...zOf(m.structures, STRIDE));
    };
    expect(top('1')).toBeGreaterThanOrEqual(LAYER_HEIGHT);
    expect(top('3')).toBeGreaterThanOrEqual(3 * LAYER_HEIGHT);
  });

  test('a bridge casts a shadow on the ground that falls further the higher the deck', () => {
    const nodes = `<node id="1" lat="52.0" lon="104.000"/><node id="2" lat="52.0" lon="104.003"/>`;
    const road = buildScene3d(osm(`${nodes}<way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="primary"/></way>`), COLORS)!;
    expect(road.shadows.length).toBe(0);
    const reach = (layer: string) => {
      const m = buildScene3d(osm(`${nodes}<way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="primary"/><tag k="bridge" v="yes"/><tag k="layer" v="${layer}"/></way>`), COLORS)!;
      // The road runs west to east, so the shadow shows as its spread to the south (y grows south).
      const ys = Array.from({ length: m.shadows.length / STRIDE }, (_, i) => m.shadows[i * STRIDE + 1]);
      expect(Math.max(...zOf(m.shadows, STRIDE))).toBeLessThan(0.5);
      return Math.max(...ys);
    };
    expect(reach('1')).toBeGreaterThan(0);
    expect(reach('2')).toBeGreaterThan(reach('1'));
  });

  test('a bridge deck carries the lane markings, and a one-lane bridge none', () => {
    const nodes = `<node id="1" lat="52.0" lon="104.000"/><node id="2" lat="52.0" lon="104.003"/>`;
    const marks = (tags: string) => {
      const m = buildScene3d(osm(`${nodes}<way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="primary"/><tag k="bridge" v="yes"/>${tags}</way>`), COLORS)!;
      // Vertices in the marking colour, just above the deck.
      return Array.from({ length: m.structures.length / STRIDE }, (_, i) => i * STRIDE).filter((o) => m.structures[o + 3] === 1 && m.structures[o + 4] === 1 && m.structures[o + 5] === 1);
    };
    expect(marks('<tag k="lanes" v="4"/>').length).toBeGreaterThan(0);
    expect(marks('<tag k="oneway" v="yes"/><tag k="lanes" v="1"/>')).toHaveLength(0);
  });

  test('a bridge cut by a junction gets a pick number per stretch, each vertex on its own stretch', () => {
    const nodes = `<node id="1" lat="52.0" lon="104.000"/><node id="2" lat="52.0" lon="104.003"/><node id="3" lat="52.0" lon="104.006"/><node id="4" lat="52.003" lon="104.003"/>`;
    const m = buildScene3d(osm(`${nodes}<way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><tag k="highway" v="primary"/><tag k="bridge" v="yes"/><tag k="layer" v="1"/></way><way id="11"><nd ref="2"/><nd ref="4"/><tag k="highway" v="residential"/></way>`), COLORS)!;
    expect(m.pickIds).toEqual(['10', '10']);
    expect(m.pickPieces).toEqual([{ from: 0, to: 1 }, { from: 1, to: 2 }]);
    const picks = new Set(Array.from({ length: m.structures.length / STRIDE }, (_, i) => m.structures[i * STRIDE + 11]));
    expect(picks.has(1) && picks.has(2)).toBe(true);
  });

  test('a tunnel is a tube under the ground, as deep as its level', () => {
    const nodes = `<node id="1" lat="52.0" lon="104.000"/><node id="2" lat="52.0" lon="104.003"/>`;
    const tube = (layer: string) => buildScene3d(osm(`${nodes}<way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="primary"/><tag k="tunnel" v="yes"/><tag k="layer" v="${layer}"/></way>`), COLORS)!;
    const z1 = zOf(tube('-1').underground, STRIDE);
    const z3 = zOf(tube('-3').underground, STRIDE);
    expect(Math.min(...z1)).toBeCloseTo(-LAYER_HEIGHT);
    expect(Math.min(...z3)).toBeCloseTo(-3 * LAYER_HEIGHT);
    // Deep in the middle, up to the full arch at the portals.
    expect(Math.max(...z3)).toBeLessThanOrEqual(5.0001);
    expect(tube('-1').pickIds).toEqual(['10']);
  });

  test('the tunnel roof is an arch: highest in the middle, lower towards the walls', () => {
    const ups = TUNNEL_PROFILE.map(([, up]) => up);
    const top = Math.max(...ups);
    expect(TUNNEL_PROFILE[ups.indexOf(top)][0]).toBeCloseTo(0.5);
    expect(TUNNEL_PROFILE[1][1]).toBeLessThan(top);
    expect(TUNNEL_PROFILE[0]).toEqual([0, 0]);
    expect(TUNNEL_PROFILE[TUNNEL_PROFILE.length - 1]).toEqual([1, 0]);
  });

  test('a tunnel gets a portal only where it meets an open road', () => {
    const nodes = `
      <node id="1" lat="52.0" lon="104.000"/><node id="2" lat="52.0" lon="104.002"/><node id="3" lat="52.0" lon="104.004"/>`;
    const lone = buildScene3d(osm(`${nodes}<way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="primary"/><tag k="tunnel" v="yes"/></way>`), COLORS)!;
    expect(lone.structures.length).toBe(0);
    const joined = buildScene3d(osm(`${nodes}
      <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="primary"/><tag k="tunnel" v="yes"/></way>
      <way id="11"><nd ref="2"/><nd ref="3"/><tag k="highway" v="primary"/></way>`), COLORS)!;
    // One arched frame: four faces per step of the arch, plus the two feet; 6 vertices a face.
    expect(joined.structures.length / STRIDE).toBe(((TUNNEL_PROFILE.length - 1) * 4 + 2) * 6);
  });

  test('builds the example without gaps in the data', () => {
    const doc = parseOsm(readFileSync(resolve(__dirname, '../test/example.osm'), 'utf8'));
    const mesh = buildScene3d(doc, COLORS)!;
    expect(mesh.solid.length).toBeGreaterThan(0);
    expect(mesh.structures.length).toBeGreaterThan(0);
    for (const arr of [mesh.solid, mesh.structures, mesh.roadMask]) expect(arr.every(Number.isFinite)).toBe(true);
  });

  test('an empty document has no scene', () => {
    expect(buildScene3d(osm(''), COLORS)).toBeNull();
  });
});

describe('bridge ends', () => {
  it('keep the deck out of the ground and lower the parapets to it', () => {
    expect(deckBottom(0)).toBeCloseTo(-0.02);
    expect(deckBottom(0.5)).toBeCloseTo(-0.02);
    expect(deckBottom(5)).toBeCloseTo(3.8);
    expect(parapetAt(0)).toBe(0);
    expect(parapetAt(5)).toBe(1);
  });
});
