import { parseOsm } from './parse';
import { bottlenecks, junctionCapacity, junctionLoad, LANE_CAPACITY } from './capacity';

/** A crossroads at node 0: a two-lane each way main road W-E (10, 20) and a side street S-N (30, 40). */
const cross = (node0 = '', side = '') => parseOsm(`<osm version="0.6">
  <node id="0" lat="52.0" lon="104.0">${node0}</node>
  <node id="1" lat="52.0" lon="103.998"/><node id="2" lat="52.0" lon="104.002"/>
  <node id="3" lat="51.998" lon="104.0"/><node id="4" lat="52.002" lon="104.0"/>
  <way id="10"><nd ref="1"/><nd ref="0"/><tag k="highway" v="primary"/><tag k="lanes" v="4"/><tag k="priority_road" v="designated"/></way>
  <way id="20"><nd ref="0"/><nd ref="2"/><tag k="highway" v="primary"/><tag k="lanes" v="4"/><tag k="priority_road" v="designated"/></way>
  <way id="30"><nd ref="3"/><nd ref="0"/><tag k="highway" v="residential"/>${side}</way>
  <way id="40"><nd ref="0"/><nd ref="4"/><tag k="highway" v="residential"/>${side}</way>
</osm>`);

describe('junction capacity', () => {
  test('main road lanes flow on, side street lanes take the gaps', () => {
    const cap = junctionCapacity(cross(), '0')!;
    const main = cap.approaches.filter((a) => a.role === 'main');
    const minor = cap.approaches.filter((a) => a.role !== 'main');
    expect(main.reduce((s, a) => s + a.lanes, 0)).toBe(4);
    expect(minor.every((a) => a.role === 'give_way')).toBe(true);
    expect(cap.total).toBe(cap.approaches.reduce((s, a) => s + a.capacity, 0));
    expect(cap.total).toBe(4 * LANE_CAPACITY.main + 2 * LANE_CAPACITY.give_way);
  });

  test('equal streets without signs share by the right-hand rule', () => {
    const doc = cross();
    const plain = { ...doc, ways: Object.fromEntries(Object.entries(doc.ways).map(([id, w]) => [id, { ...w, tags: { highway: 'residential' } }])) };
    expect(junctionCapacity(plain, '0')!.approaches.every((a) => a.role === 'equal')).toBe(true);
  });

  test('a traffic light makes every approach share the cycle', () => {
    const cap = junctionCapacity(cross('<tag k="highway" v="traffic_signals"/>'), '0')!;
    expect(cap.approaches.every((a) => a.role === 'signal')).toBe(true);
    expect(cap.total).toBe(6 * LANE_CAPACITY.signal);
  });

  test('a node where only two roads meet is not a junction', () => {
    expect(junctionCapacity(cross(), '1')).toBeNull();
  });

  test('a run that put 1800 vehicles an hour through a 3600 capacity junction loads it to a half', () => {
    const doc = cross('<tag k="highway" v="traffic_signals"/>');
    const cap = junctionCapacity(doc, '0')!;
    // 10 minutes; every car is counted on the road in and the road out.
    const ways = [{ way: '10', entered: 200, delay_s: 20 }, { way: '20', entered: 200, delay_s: 10 }, { way: '30', entered: 100, delay_s: 40 }, { way: '40', entered: 100, delay_s: 0 }];
    const run = junctionLoad(doc, cap, ways, 600)!;
    expect(run.flow).toBe(1800);
    expect(run.load).toBeCloseTo(1800 / cap.total, 5);
    expect(run.delay).toBeCloseTo((200 * 20 + 200 * 10 + 100 * 40) / 600, 5);
    expect(bottlenecks(doc, ways, 600, 5)).toHaveLength(1);
  });
});
