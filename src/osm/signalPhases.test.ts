import { parseOsm } from './parse';
import { approachesOf, approachTimeline, axesOf, cycleOf, defaultPhases, pedGreen, webster } from './signalPhases';
import { armKey } from './lanes';

/** A crossroads at node 0 of four two-way roads of two lanes, with a light. */
const doc = parseOsm(`<osm version="0.6">
  <node id="0" lat="52.0000" lon="104.0000"><tag k="highway" v="traffic_signals"/></node>
  <node id="1" lat="51.9990" lon="104.0000"/><node id="2" lat="52.0000" lon="103.9985"/><node id="3" lat="52.0010" lon="104.0000"/><node id="4" lat="52.0000" lon="104.0015"/>
  <way id="10"><nd ref="1"/><nd ref="0"/><tag k="highway" v="primary"/><tag k="lanes" v="2"/></way>
  <way id="20"><nd ref="2"/><nd ref="0"/><tag k="highway" v="primary"/><tag k="lanes" v="2"/></way>
  <way id="30"><nd ref="3"/><nd ref="0"/><tag k="highway" v="primary"/><tag k="lanes" v="2"/></way>
  <way id="40"><nd ref="4"/><nd ref="0"/><tag k="highway" v="primary"/><tag k="lanes" v="2"/></way>
</osm>`);

describe('traffic light phases', () => {
  const arms = approachesOf(doc, '0');

  test('facing approaches pair up into two axes', () => {
    const axes = axesOf(arms);
    expect(axes).toHaveLength(2);
    expect(axes.every((a) => a.length === 2)).toBe(true);
  });

  test('a default plan moves each axis in turn and fills the cycle', () => {
    const phases = defaultPhases(doc, '0', { cycle: 90 });
    expect(phases).toHaveLength(2);
    expect(cycleOf(phases)).toBe(90);
    const left = defaultPhases(doc, '0', { leftArrow: true, ped: true });
    expect(left.map((p) => (p.ped ? 'ped' : Object.values(p.moves)[0]))).toEqual(['left', 'noleft', 'left', 'noleft', 'ped']);
  });

  test('an approach shows green, yellow, then red until its phase comes again', () => {
    const phases = defaultPhases(doc, '0', { cycle: 90 });
    const key = Object.keys(phases[0].moves)[0];
    const t = approachTimeline(phases, key);
    expect(t.map((r) => r.light)).toEqual(['green', 'yellow', 'red']);
    expect(t[0].to).toBe(phases[0].green);
    expect(t[t.length - 1].to).toBe(90);
  });

  test('Webster gives a longer cycle for heavier flows and more green to the busier axis', () => {
    const phases = defaultPhases(doc, '0', { cycle: 90 });
    const busy = Object.keys(phases[0].moves);
    const light = webster(phases, arms, (k) => (busy.includes(k) ? 600 : 300))!;
    const heavy = webster(phases, arms, (k) => (busy.includes(k) ? 1000 : 600))!;
    expect(heavy.cycle).toBeGreaterThan(light.cycle);
    expect(light.phases[0].green).toBeGreaterThan(light.phases[1].green);
    expect(webster(phases, arms, () => 3000)).toBeNull();
    expect(arms.map(armKey)).toHaveLength(4);
  });

  test('people need 7 s to start plus the walk across', () => {
    expect(pedGreen(12, 1.2)).toBe(17);
  });
});
