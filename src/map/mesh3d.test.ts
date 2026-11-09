import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseOsm } from '../osm/parse';
import { bridgeHeight, buildScene3d, deckProfile, LANE_WIDTH, LAYER_HEIGHT, roadWidth, STRIDE, type Scene3dColors } from './mesh3d';

const COLORS: Scene3dColors = {
  building: [0.8, 0.7, 0.6], edge: [0.5, 0.4, 0.3], deck: () => [1, 0.8, 0], deckSide: [0.5, 0.4, 0.3], pier: [0.5, 0.4, 0.3], portal: [0.5, 0.4, 0.3],
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
    // Every building vertex may be cut away.
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

  test('a tunnel gets a portal only where it meets an open road', () => {
    const nodes = `
      <node id="1" lat="52.0" lon="104.000"/><node id="2" lat="52.0" lon="104.002"/><node id="3" lat="52.0" lon="104.004"/>`;
    const lone = buildScene3d(osm(`${nodes}<way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="primary"/><tag k="tunnel" v="yes"/></way>`), COLORS)!;
    expect(lone.structures.length).toBe(0);
    const joined = buildScene3d(osm(`${nodes}
      <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="primary"/><tag k="tunnel" v="yes"/></way>
      <way id="11"><nd ref="2"/><nd ref="3"/><tag k="highway" v="primary"/></way>`), COLORS)!;
    // Three boxes (two pillars and a lintel), 5 faces of 2 triangles and 2 cap triangles each.
    expect(joined.structures.length / STRIDE).toBe(3 * (4 * 2 + 2) * 3);
  });

  test('builds the example without gaps in the data', () => {
    const doc = parseOsm(readFileSync(resolve(__dirname, '../test/example.osm'), 'utf8'));
    const mesh = buildScene3d(doc, COLORS)!;
    expect(mesh.solid.length).toBeGreaterThan(0);
    expect(mesh.structures.length).toBeGreaterThan(0);
    for (const arr of [mesh.solid, mesh.structures, mesh.edges, mesh.roadMask]) expect(arr.every(Number.isFinite)).toBe(true);
  });

  test('an empty document has no scene', () => {
    expect(buildScene3d(osm(''), COLORS)).toBeNull();
  });
});
