import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { falseTunnels, groundTags, webotsElevation } from './structures';
import { parseOsm } from './parse';

/** Street 2 goes over street 1 on a bridge; a 30 m piece of street 1 under it is tagged as a tunnel. */
const XML = `<osm version="0.6">
  <node id="1" lat="52.0000" lon="104.0000"/><node id="2" lat="52.0000" lon="104.0010"/>
  <node id="3" lat="52.0000" lon="104.0014"/><node id="4" lat="52.0000" lon="104.0030"/>
  <node id="5" lat="51.9995" lon="104.0012"/><node id="6" lat="52.0005" lon="104.0012"/>
  <node id="7" lat="52.0010" lon="104.0000"/><node id="8" lat="52.0010" lon="104.0040"/>
  <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="primary"/></way>
  <way id="11"><nd ref="2"/><nd ref="3"/><tag k="highway" v="primary"/><tag k="tunnel" v="yes"/><tag k="layer" v="-1"/></way>
  <way id="12"><nd ref="3"/><nd ref="4"/><tag k="highway" v="primary"/></way>
  <way id="20"><nd ref="5"/><nd ref="6"/><tag k="highway" v="secondary"/><tag k="bridge" v="yes"/><tag k="layer" v="1"/></way>
  <way id="30"><nd ref="7"/><nd ref="8"/><tag k="highway" v="primary"/><tag k="tunnel" v="yes"/><tag k="layer" v="-1"/></way>
</osm>`;

describe('false tunnels under bridges', () => {
  test('finds a short tunnel that only passes under a bridge', () => {
    const found = falseTunnels(parseOsm(XML));
    expect(found.map((f) => [f.wayId, f.bridgeId])).toEqual([['11', '20']]);
    expect(found[0].lengthM).toBeCloseTo(27, 0);
  });

  test('a tunnel with no bridge over it is left alone', () => {
    expect(falseTunnels(parseOsm(XML)).some((f) => f.wayId === '30')).toBe(false);
  });

  test('the fix keeps the road on the ground', () => {
    expect(groundTags({ highway: 'primary', tunnel: 'yes', layer: '-1' })).toEqual({ highway: 'primary' });
    expect(groundTags({ highway: 'primary', tunnel: 'yes', layer: '1' })).toEqual({ highway: 'primary', layer: '1' });
  });

  test('Webots elevation is layer × 5 m, and underground ways are skipped', () => {
    expect(webotsElevation({ layer: '-1' })).toBeNull();
    expect(webotsElevation({ layer: '1' })).toBe(5);
    expect(webotsElevation({})).toBe(0);
  });

  test('the bypass and its ramp under the Lermontova overpass in the task fragment', () => {
    const doc = parseOsm(readFileSync(resolve(__dirname, '../test/example.osm'), 'utf8'));
    const found = falseTunnels(doc);
    expect(found.map((f) => f.wayId).sort()).toEqual(['1199781529', '1199781531', '1199781533']);
    expect(found.every((f) => f.bridgeId === '81608266')).toBe(true);
  });
});
