import { parseOsm } from './parse';
import { applyRules, isAuto, networkChange } from './rules';
import { armsAt } from './lanes';
import { approachSign } from './signs';
import { setNodeTags } from './edit';

const tag = (t: Record<string, string>) => Object.entries(t).map(([k, v]) => `<tag k="${k}" v="${v}"/>`).join('');
/** A T junction at node 0: a secondary street west–east, a residential one from the south. */
const T = (extra = '', south: Record<string, string> = { highway: 'residential' }) => parseOsm(`<osm version="0.6">
  <node id="0" lat="52.0000" lon="104.0000"/><node id="1" lat="52.0000" lon="103.9970"/><node id="2" lat="52.0000" lon="104.0030"/><node id="3" lat="51.9970" lon="104.0000"/>
  <way id="10"><nd ref="1"/><nd ref="0"/>${tag({ highway: 'secondary' })}</way>
  <way id="20"><nd ref="0"/><nd ref="2"/>${tag({ highway: 'secondary' })}</way>
  <way id="30"><nd ref="3"/><nd ref="0"/>${tag(south)}</way>${extra}</osm>`);

describe('the traffic rules kept by the editor', () => {
  test('the higher road is the main one, the lower street gives way', () => {
    const { doc, counts } = applyRules(T());
    const sign = (way: string) => approachSign(doc, '0', armsAt(doc, '0').find((a) => a.wayId === way)!);
    expect(sign('10')).toBe('main');
    expect(sign('30')).toBe('give_way');
    expect(counts['2.4']).toBe(1);
    expect(doc.ways['30'].tags.maxspeed).toBe('60');
  });

  test('a light takes the priority signs away; a sign put by hand stays', () => {
    const { doc } = applyRules(T());
    const lit = applyRules(setNodeTags(doc, '0', { highway: 'traffic_signals' }), { ways: new Set(), nodes: new Set(['0']) }).doc;
    expect(Object.values(lit.nodes).some((n) => n.tags.highway === 'give_way' && isAuto(n.tags))).toBe(false);
    const manual = T('<node id="9" lat="51.9997" lon="104.0000"><tag k="highway" v="stop"/><tag k="direction" v="forward"/></node>').ways;
    expect(manual).toBeTruthy();
  });

  test('equal streets keep the right-hand rule, a yard exit gets nothing', () => {
    const eq = applyRules(T('', { highway: 'secondary' })).doc;
    expect(Object.values(eq.nodes).some((n) => n.tags.highway === 'give_way')).toBe(false);
    const yard = applyRules(T('', { highway: 'service' })).doc;
    expect(Object.values(yard.nodes).some((n) => n.tags.highway === 'give_way')).toBe(false);
  });

  test('a one-way street gets 5.5 where it begins and 3.1 at its end', () => {
    const { doc } = applyRules(T('', { highway: 'residential', oneway: 'yes' }));
    const signs = Object.values(doc.nodes).map((n) => n.tags.traffic_sign).filter(Boolean);
    expect(signs).toContain('RU:5.5');
    expect(signs).toContain('RU:3.1');
  });

  test('a footpath across a street gets a crossing, a road across rails a level crossing', () => {
    const walk = applyRules(T(`<node id="5" lat="51.9985" lon="103.9990"/><node id="6" lat="51.9985" lon="104.0010"/><way id="40"><nd ref="5"/><nd ref="6"/>${tag({ highway: 'footway' })}</way>`), { ways: new Set(['40']), nodes: new Set() }).doc;
    expect(Object.values(walk.nodes).some((n) => n.tags.highway === 'crossing' && walk.ways['40'].refs.includes(n.id) && walk.ways['30'].refs.includes(n.id))).toBe(true);
    const rail = applyRules(T(`<node id="7" lat="51.9985" lon="103.9990"/><node id="8" lat="51.9985" lon="104.0010"/><way id="50"><nd ref="7"/><nd ref="8"/>${tag({ railway: 'rail' })}</way>`), { ways: new Set(['50']), nodes: new Set() });
    expect(Object.values(rail.doc.nodes).some((n) => n.tags.railway === 'level_crossing')).toBe(true);
    expect(rail.counts['1.2']).toBeGreaterThan(0);
  });

  test('only edits of the network wake the rules', () => {
    const doc = T();
    expect(networkChange(doc, doc)).toBeNull();
    const moved = { ...doc, nodes: { ...doc.nodes, '3': { ...doc.nodes['3'], lon: 104.0001 } } };
    expect(networkChange(doc, moved)).toBeNull();
    const retagged = { ...doc, ways: { ...doc.ways, '30': { ...doc.ways['30'], tags: { highway: 'tertiary' } } } };
    expect(networkChange(doc, retagged)?.ways.has('30')).toBe(true);
  });
});
