import { flowBundle, bundleFeatures } from './bundle';
import { buildNetwork, nearestNode, type Zone } from './model';
import { parseOsm } from '../osm/parse';

/**
 * Three zones on a T: A (west) — B (east) along way 10/11, C to the south via way 12.
 *   A 1 —10— 2 —11— 3 B
 *            |
 *            12
 *            |
 *            4 C
 */
const XML = `<osm version="0.6">
  <node id="1" lat="52.0000" lon="104.0000"/><node id="2" lat="52.0000" lon="104.0030"/><node id="3" lat="52.0000" lon="104.0060"/>
  <node id="4" lat="51.9970" lon="104.0030"/>
  <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="primary"/></way>
  <way id="11"><nd ref="2"/><nd ref="3"/><tag k="highway" v="primary"/></way>
  <way id="12"><nd ref="2"/><nd ref="4"/><tag k="highway" v="secondary"/></way>
</osm>`;

describe('flow bundle', () => {
  const net = buildNetwork(parseOsm(XML));
  const zone = (id: number, name: string, nodeId: string): Zone => {
    const node = net.nodeIds.indexOf(nodeId);
    return { id, name, node, lonlat: net.lonlat[node], weight: 1 } as Zone;
  };
  const zones = [zone(1, 'A', '1'), zone(2, 'B', '3'), zone(3, 'C', '4')];
  const od = [[0, 100, 40], [80, 0, 10], [30, 5, 0]];
  const time = net.links.map((l) => l.t0);

  test('collects every zone pair whose route uses the road', () => {
    const b = flowBundle(net, zones, od, time, '12');
    expect(b.pairs.map((p) => `${p.from}→${p.to}:${p.trips}`)).toEqual(['A→C:40', 'C→A:30', 'B→C:10', 'C→B:5']);
    expect(b.total).toBe(85);
  });

  test('bundle volume on the other roads shows where those trips come from', () => {
    const b = flowBundle(net, zones, od, time, '12');
    const onWay = (wayId: string) => net.links.reduce((s, l, i) => s + (l.wayId === wayId ? b.linkVolume[i] : 0), 0);
    expect(onWay('12')).toBe(85);
    expect(onWay('10')).toBe(70);
    expect(onWay('11')).toBe(15);
  });

  test('map features mark the chosen road and scale by share', () => {
    const b = flowBundle(net, zones, od, time, '12');
    const f = bundleFeatures(net, b) as Array<{ properties: { own: boolean; share: number } }>;
    expect(f.filter((x) => x.properties.own).length).toBe(2);
    expect(Math.max(...f.map((x) => x.properties.share))).toBeLessThanOrEqual(1);
  });

  test('a road no trip uses gives an empty bundle', () => {
    expect(flowBundle(net, zones, [[0, 0, 0], [0, 0, 0], [0, 0, 0]], time, '12').total).toBe(0);
    expect(nearestNode(net, [104.0031, 52.0001])).toBe(net.nodeIds.indexOf('2'));
  });
});

describe('flow bundle on the task fragment', () => {
  test('the bypass carries trips between several zone pairs', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const { computeFlows } = await import('./compute');
    const { bundleFor } = await import('./bundle');
    const doc = parseOsm(readFileSync(resolve(__dirname, '../../submission/hack-team10.osm'), 'utf8'));
    const result = computeFlows(doc, { side: 3, trips: 3000 });
    const built = bundleFor(doc, result, '140226629')!;
    expect(built).not.toBeNull();
    expect(built.bundle.total).toBeGreaterThan(0);
    expect(built.bundle.pairs.length).toBeGreaterThan(1);
    console.info('bypass bundle', Math.round(built.bundle.total), 'trips/h', built.bundle.pairs.slice(0, 3));
  }, 120000);
});
