import { parseOsm } from '../osm/parse';
import { APPROACH_LENGTH, isLifted, nodeElevations } from './elevation';

/**
 * A bridge (way 10, nodes 1-2) carries a street from west to east over a road below (way 30).
 * The street goes on as ways 20 (east of the bridge) and 21 (west); a ramp (way 40) comes up
 * from the road below to the east end of the bridge. Nodes are ~70 m apart along the street.
 */
const doc = parseOsm(`<osm version="0.6">
  <node id="1" lat="52.0" lon="104.000"/><node id="2" lat="52.0" lon="104.001"/>
  <node id="3" lat="52.0" lon="104.002"/><node id="4" lat="52.0" lon="104.0045"/>
  <node id="5" lat="52.0" lon="103.999"/>
  <node id="6" lat="51.999" lon="104.0005"/><node id="7" lat="52.001" lon="104.0005"/>
  <node id="8" lat="51.9995" lon="104.0025"/>
  <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="secondary"/><tag k="bridge" v="yes"/><tag k="layer" v="1"/></way>
  <way id="20"><nd ref="2"/><nd ref="3"/><nd ref="4"/><tag k="highway" v="secondary"/></way>
  <way id="21"><nd ref="5"/><nd ref="1"/><tag k="highway" v="secondary"/></way>
  <way id="30"><nd ref="6"/><nd ref="7"/><tag k="highway" v="primary"/></way>
  <way id="40"><nd ref="2"/><nd ref="8"/><tag k="highway" v="secondary_link"/></way>
</osm>`);

describe('approach embankments', () => {
  const z = nodeElevations(doc);

  test('the bridge ends stand at deck height', () => {
    expect(z.get('1')).toBe(5);
    expect(z.get('2')).toBe(5);
  });

  test('the street comes down to the ground along its approach', () => {
    const at3 = z.get('3') ?? 0;
    expect(at3).toBeGreaterThan(0);
    expect(at3).toBeLessThan(5);
    // Node 4 is further than one approach length from the bridge.
    expect(z.get('4') ?? 0).toBe(0);
    expect(APPROACH_LENGTH).toBeGreaterThan(50);
  });

  test('the road under the bridge stays on the ground, a ramp up to it is lifted', () => {
    expect(z.get('6') ?? 0).toBe(0);
    expect(z.get('7') ?? 0).toBe(0);
    expect(isLifted(doc, doc.ways['30'])).toBe(false);
    expect(isLifted(doc, doc.ways['40'])).toBe(true);
    expect(isLifted(doc, doc.ways['20'])).toBe(true);
  });
});
