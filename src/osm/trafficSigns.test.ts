import { parseOsm } from './parse';
import { placeSign, removeSign, signDef, signsOf, signTags } from './trafficSigns';
import { signPoints } from './signs';

const doc = parseOsm(`<osm version="0.6">
  <node id="1" lat="52.0" lon="104.000"/><node id="2" lat="52.0" lon="104.002"/>
  <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/></way>
</osm>`);

describe('road signs placed on the map', () => {
  test('a sign is a node on the road with traffic_sign and the direction it faces', () => {
    const r = placeSign(doc, '10', 0, 104.001, 52.0, signDef('3.24')!, false, 30);
    expect(r.nodeId).toBeTruthy();
    expect(r.doc.ways['10'].refs).toHaveLength(3);
    expect(r.doc.nodes[r.nodeId!].tags).toEqual({ traffic_sign: 'RU:3.24[30]', direction: 'backward' });
    expect(signsOf(r.doc.nodes[r.nodeId!].tags)).toEqual([{ code: '3.24', value: 30 }]);
    expect(signPoints(r.doc).features.some((f) => f.properties.sign === 'ts:3.24:30')).toBe(true);
  });

  test('signs with a tag of their own write it too, two signs share a post', () => {
    expect(signTags(signDef('2.4')!, true)).toMatchObject({ highway: 'give_way', direction: 'forward', traffic_sign: 'RU:2.4' });
    expect(signTags(signDef('signal')!, true)).toMatchObject({ highway: 'traffic_signals' });
    const one = placeSign(doc, '10', 0, 104.001, 52.0, signDef('3.27')!, true);
    const two = placeSign(one.doc, '10', 0, 104.001, 52.0, signDef('3.24')!, true, 40, one.nodeId);
    expect(two.doc.nodes[one.nodeId!].tags.traffic_sign).toBe('RU:3.27;RU:3.24[40]');
    const left = removeSign(two.doc, one.nodeId!, '3.27');
    expect(left.nodes[one.nodeId!].tags.traffic_sign).toBe('RU:3.24[40]');
  });

  test('2.1 marks the road as the main one', () => {
    const r = placeSign(doc, '10', 0, 104.001, 52.0, signDef('2.1')!, true);
    expect(r.doc.ways['10'].tags.priority_road).toBe('designated');
  });
});
