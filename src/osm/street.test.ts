import { commonValue, normaliseStreet, setStreetLanes, setStreetTag, streetLengthM, streetWays } from './street';
import { parseOsm } from './parse';

/** Street «Лермонтова» in three parts (one of them oneway), plus a footway with the same name. */
const XML = `<osm version="0.6">
  <node id="1" lat="52.000" lon="104.000"/><node id="2" lat="52.001" lon="104.000"/>
  <node id="3" lat="52.002" lon="104.000"/><node id="4" lat="52.003" lon="104.000"/>
  <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="primary"/><tag k="name" v="Лермонтова"/><tag k="lanes" v="4"/><tag k="maxspeed" v="60"/></way>
  <way id="11"><nd ref="2"/><nd ref="3"/><tag k="highway" v="primary"/><tag k="name" v="Лермонтова"/><tag k="lanes" v="2"/><tag k="lanes:forward" v="1"/><tag k="lanes:backward" v="1"/><tag k="maxspeed" v="60"/></way>
  <way id="12"><nd ref="3"/><nd ref="4"/><tag k="highway" v="primary"/><tag k="name" v="Лермонтова"/><tag k="oneway" v="yes"/></way>
  <way id="13"><nd ref="1"/><nd ref="4"/><tag k="highway" v="footway"/><tag k="name" v="Лермонтова"/></way>
  <way id="14"><nd ref="1"/><nd ref="3"/><tag k="highway" v="residential"/><tag k="name" v="Другая"/></way>
</osm>`;

describe('street group edits', () => {
  const doc = parseOsm(XML);

  test('a street is every drivable way with the name, footways excluded', () => {
    expect(streetWays(doc, 'Лермонтова').map((w) => w.id)).toEqual(['10', '11', '12']);
    expect(streetLengthM(doc, streetWays(doc, 'Лермонтова'))).toBeCloseTo(333.6, 0);
  });

  test('shows a common value only when all parts agree', () => {
    const ways = streetWays(doc, 'Лермонтова');
    expect(commonValue(ways, 'highway')).toBe('primary');
    expect(commonValue(ways, 'lanes')).toBeNull();
    expect(commonValue(ways, 'surface')).toBe('');
  });

  test('sets a tag on every part in one document change and leaves other streets alone', () => {
    const d = setStreetTag(doc, 'Лермонтова', 'maxspeed', '50');
    expect(['10', '11', '12'].map((id) => d.ways[id].tags.maxspeed)).toEqual(['50', '50', '50']);
    expect(d.ways['13']).toBe(doc.ways['13']);
    expect(d.ways['14']).toBe(doc.ways['14']);
    expect(setStreetTag(d, 'Лермонтова', 'maxspeed', '50')).toBe(d);
    expect(setStreetTag(doc, 'Лермонтова', 'maxspeed', null).ways['10'].tags.maxspeed).toBeUndefined();
  });

  test('setting total lanes drops contradicting per-direction counts', () => {
    const d = setStreetLanes(doc, 'Лермонтова', '4');
    expect(d.ways['11'].tags).toMatchObject({ lanes: '4' });
    expect(d.ways['11'].tags['lanes:forward']).toBeUndefined();
    expect(d.ways['12'].tags.lanes).toBe('4');
  });

  test('normalising fills missing speed and width on every part', () => {
    const d = normaliseStreet(doc, 'Лермонтова');
    expect(d.ways['12'].tags.maxspeed).toBeDefined();
    expect(d.ways['12'].tags.width).toBeDefined();
  });

  test('unknown street is a no-op', () => {
    expect(setStreetTag(doc, 'Нет такой', 'lanes', '2')).toBe(doc);
  });
});
