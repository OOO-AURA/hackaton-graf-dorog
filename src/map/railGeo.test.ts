import { parseOsm } from '../osm/parse';
import { contextGeoJson, nodesGeoJson, railGeoJson, stationGeoJson } from './geojson';

const doc = parseOsm(`<osm version="0.6">
  <node id="1" lat="52.0" lon="104.000"/><node id="2" lat="52.0" lon="104.001"/><node id="3" lat="52.0" lon="104.002"/>
  <node id="4" lat="52.001" lon="104.000"/><node id="5" lat="52.001" lon="104.001"/>
  <node id="6" lat="52.0005" lon="104.0015"><tag k="railway" v="halt"/><tag k="name" v="Иркутск-Сортировочный"/></node>
  <node id="7" lat="52.0008" lon="104.0005"><tag k="public_transport" v="platform"/></node>
  <way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><tag k="railway" v="rail"/><tag k="gauge" v="1520"/></way>
  <way id="11"><nd ref="4"/><nd ref="5"/><tag k="railway" v="tram"/></way>
  <way id="12"><nd ref="1"/><nd ref="4"/><tag k="railway" v="platform"/></way>
  <way id="13"><nd ref="2"/><nd ref="5"/><tag k="highway" v="footway"/></way>
</osm>`);

describe('railways on the map', () => {
  test('tracks and platforms are their own layer, footways stay in the context', () => {
    const rails = railGeoJson(doc).features;
    expect(rails.map((f) => [f.properties.id, f.properties.kind])).toEqual([['10', 'rail'], ['11', 'tram'], ['12', 'platform']]);
    expect(contextGeoJson(doc).lines.features.map((f) => f.properties.id)).toEqual(['13']);
  });

  test('stations are points with their name, platform nodes are not stations', () => {
    const st = stationGeoJson(doc).features;
    expect(st).toHaveLength(1);
    expect(st[0].properties).toMatchObject({ id: '6', kind: 'halt', name: 'Иркутск-Сортировочный' });
  });

  test('track nodes can be picked and dragged like road nodes', () => {
    const ids = nodesGeoJson(doc, '10').features.map((f) => f.properties.id);
    expect(ids).toEqual(expect.arrayContaining(['1', '2', '3', '4', '5']));
  });
});
