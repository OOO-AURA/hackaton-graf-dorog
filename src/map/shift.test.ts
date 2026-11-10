import { parseOsm } from '../osm/parse';
import { roadTapers } from './section';
import { roadShifts } from './shift';

const tag = (tags: Record<string, string>) => Object.entries(tags).map(([k, v]) => `<tag k="${k}" v="${v}"/>`).join('');

/**
 * A two-way road 1→2 east, then at node 2 two roads go on east: way 11 straight on, way 12
 * starting on the same point and drawing away to the north by `gap` degrees at its end.
 */
const fork = (wide: Record<string, string>, a: Record<string, string>, b: Record<string, string>, gap = 0.0003) => parseOsm(`<osm version="0.6">
  <node id="1" lat="52.0" lon="104.000"/><node id="2" lat="52.0" lon="104.003"/>
  <node id="3" lat="52.0" lon="104.006"/>
  <node id="4" lat="52.00002" lon="104.0035"/><node id="5" lat="${52 + gap}" lon="104.006"/>
  <way id="10"><nd ref="1"/><nd ref="2"/>${tag(wide)}</way>
  <way id="11"><nd ref="2"/><nd ref="3"/>${tag(a)}</way>
  <way id="12"><nd ref="2"/><nd ref="4"/><nd ref="5"/>${tag(b)}</way></osm>`);

const twoWay = (lanes: number) => ({ highway: 'secondary', lanes: String(lanes) });
const oneway = (lanes: number) => ({ highway: 'secondary', oneway: 'yes', lanes: String(lanes) });
const link = { highway: 'secondary_link', oneway: 'yes', lanes: '1' };

describe('forks', () => {
  test('a road whose lanes go on into several roads side by side does not narrow', () => {
    // 3 + 2 lanes go on as 2 + 2 and one slip road.
    expect(roadTapers(fork(twoWay(5), twoWay(4), link)).has('10')).toBe(false);
  });

  test('a road that really loses lanes still narrows', () => {
    const doc = parseOsm(`<osm version="0.6">
      <node id="1" lat="52.0" lon="104.000"/><node id="2" lat="52.0" lon="104.003"/><node id="3" lat="52.0" lon="104.006"/>
      <way id="10"><nd ref="1"/><nd ref="2"/>${tag(twoWay(6))}</way>
      <way id="11"><nd ref="2"/><nd ref="3"/>${tag(twoWay(4))}</way></osm>`);
    expect(roadTapers(doc).has('10')).toBe(true);
  });

  test('a slip road starting on the main road is drawn alongside it, then on its own line', () => {
    const offs = roadShifts(fork(twoWay(6), twoWay(4), link)).get('12')!;
    // Half the main road (7 m) and half the slip road (1.75 m), to the north: left of the way.
    expect(offs[0]).toBeCloseTo(8.75);
    expect(offs[1]).toBeGreaterThan(0);
    expect(offs[1]).toBeLessThan(8.75);
    expect(offs[2]).toBe(0);
    expect(roadShifts(fork(twoWay(6), twoWay(4), link)).has('11')).toBe(false);
  });

  test('two equal halves of a dual carriageway each move half the way', () => {
    const doc = fork(twoWay(6), oneway(3), oneway(3));
    const total = Math.abs(roadShifts(doc).get('11')?.[0] ?? 0) + Math.abs(roadShifts(doc).get('12')?.[0] ?? 0);
    expect(total).toBeCloseTo(10.5);
  });
});
