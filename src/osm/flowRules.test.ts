import { parseOsm } from './parse';
import { flowRuleIssues } from './flowRules';

const osm = (body: string) => parseOsm(`<osm version="0.6">${body}</osm>`);

describe('traffic flow rules', () => {
  test('two one-way roads driving into each other: head-on, nowhere to go', () => {
    const doc = osm(`
      <node id="1" lat="52.0" lon="103.999"/><node id="2" lat="52.0" lon="104.000"/><node id="3" lat="52.0" lon="104.001"/>
      <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/><tag k="oneway" v="yes"/></way>
      <way id="20"><nd ref="3"/><nd ref="2"/><tag k="highway" v="residential"/><tag k="oneway" v="yes"/></way>`);
    const issues = flowRuleIssues(doc);
    expect(issues.map((i) => i.kind)).toEqual(['head-on']);
    expect(issues[0].nodeIds).toEqual(['2']);
    expect(issues[0].fix).toEqual({ type: 'flip', wayId: expect.any(String) });
  });

  test('one-way roads leaving a node with nothing coming in: nobody can get there', () => {
    const doc = osm(`
      <node id="1" lat="52.0" lon="103.999"/><node id="2" lat="52.0" lon="104.000"/><node id="3" lat="52.0" lon="104.001"/>
      <way id="10"><nd ref="2"/><nd ref="1"/><tag k="highway" v="residential"/><tag k="oneway" v="yes"/></way>
      <way id="20"><nd ref="2"/><nd ref="3"/><tag k="highway" v="residential"/><tag k="oneway" v="yes"/></way>`);
    expect(flowRuleIssues(doc).map((i) => i.kind)).toEqual(['head-on']);
  });

  test('a one-way street running on is fine', () => {
    const doc = osm(`
      <node id="1" lat="52.0" lon="103.999"/><node id="2" lat="52.0" lon="104.000"/><node id="3" lat="52.0" lon="104.001"/>
      <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/><tag k="oneway" v="yes"/></way>
      <way id="20"><nd ref="2"/><nd ref="3"/><tag k="highway" v="residential"/><tag k="oneway" v="yes"/></way>`);
    expect(flowRuleIssues(doc)).toEqual([]);
  });

  /**
   * A dual carriageway along x: the northern carriageway (way 10) runs west, the southern one
   * (way 20) east, as in right-hand traffic. A short link joins them.
   */
  const dual = (link: string) => osm(`
    <node id="1" lat="52.0002" lon="104.002"/><node id="2" lat="52.0002" lon="104.000"/><node id="3" lat="52.0002" lon="103.998"/>
    <node id="4" lat="51.9998" lon="103.998"/><node id="5" lat="51.9998" lon="104.000"/><node id="6" lat="51.9998" lon="104.002"/>
    <way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><tag k="highway" v="primary"/><tag k="oneway" v="yes"/></way>
    <way id="20"><nd ref="4"/><nd ref="5"/><nd ref="6"/><tag k="highway" v="primary"/><tag k="oneway" v="yes"/></way>
    ${link}`);

  test('a U-turn link turning left onto the other carriageway is right', () => {
    // Westbound on the north side, turn left (south) onto the eastbound carriageway.
    const doc = dual('<way id="30"><nd ref="2"/><nd ref="5"/><tag k="highway" v="primary_link"/><tag k="oneway" v="yes"/></way>');
    expect(flowRuleIssues(doc).filter((i) => i.kind === 'wrong-uturn')).toEqual([]);
  });

  test('a U-turn link that makes traffic turn right onto the oncoming carriageway is an error', () => {
    // Carriageways swapped (left-hand traffic): westbound on the south, eastbound on the north.
    const doc = osm(`
      <node id="1" lat="51.9998" lon="104.002"/><node id="2" lat="51.9998" lon="104.000"/><node id="3" lat="51.9998" lon="103.998"/>
      <node id="4" lat="52.0002" lon="103.998"/><node id="5" lat="52.0002" lon="104.000"/><node id="6" lat="52.0002" lon="104.002"/>
      <way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><tag k="highway" v="primary"/><tag k="oneway" v="yes"/></way>
      <way id="20"><nd ref="4"/><nd ref="5"/><nd ref="6"/><tag k="highway" v="primary"/><tag k="oneway" v="yes"/></way>
      <way id="30"><nd ref="2"/><nd ref="5"/><tag k="highway" v="primary_link"/><tag k="oneway" v="yes"/></way>`);
    const wrong = flowRuleIssues(doc).filter((i) => i.kind === 'wrong-uturn');
    expect(wrong).toHaveLength(1);
    expect(wrong[0].wayIds).toContain('30');
    expect(wrong[0].fix).toEqual({ type: 'flip', wayId: '30' });
  });

  test('a two-way link between carriageways is checked both ways and made one-way the right way', () => {
    const doc = osm(`
      <node id="1" lat="51.9998" lon="104.002"/><node id="2" lat="51.9998" lon="104.000"/><node id="3" lat="51.9998" lon="103.998"/>
      <node id="4" lat="52.0002" lon="103.998"/><node id="5" lat="52.0002" lon="104.000"/><node id="6" lat="52.0002" lon="104.002"/>
      <way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><tag k="highway" v="primary"/><tag k="oneway" v="yes"/></way>
      <way id="20"><nd ref="4"/><nd ref="5"/><nd ref="6"/><tag k="highway" v="primary"/><tag k="oneway" v="yes"/></way>
      <way id="30"><nd ref="2"/><nd ref="5"/><tag k="highway" v="service"/></way>`);
    const wrong = flowRuleIssues(doc).filter((i) => i.kind === 'wrong-uturn');
    expect(wrong).toHaveLength(1);
    expect(wrong[0].fix).toEqual({ type: 'oneway', wayId: '30', value: '-1' });
  });
});
