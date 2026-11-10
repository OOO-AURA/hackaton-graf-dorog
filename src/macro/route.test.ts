import { fastestRoute } from './route';
import { parseOsm } from '../osm/parse';

/** West → east street with a one-way piece in the middle (2 → 3 only). */
const XML = `<osm version="0.6">
  <node id="1" lat="52.0" lon="104.000"/><node id="2" lat="52.0" lon="104.003"/><node id="3" lat="52.0" lon="104.006"/><node id="4" lat="52.0" lon="104.009"/>
  <node id="9" lat="52.01" lon="104.0"/>
  <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="primary"/><tag k="name" v="Лермонтова"/><tag k="maxspeed" v="60"/></way>
  <way id="11"><nd ref="2"/><nd ref="3"/><tag k="highway" v="primary"/><tag k="name" v="Лермонтова"/><tag k="oneway" v="yes"/><tag k="maxspeed" v="60"/></way>
  <way id="12"><nd ref="3"/><nd ref="4"/><tag k="highway" v="secondary"/><tag k="name" v="Игошина"/><tag k="maxspeed" v="60"/></way>
</osm>`;

describe('fastestRoute', () => {
  const doc = parseOsm(XML);

  test('finds the route with length, free-flow time and streets in order', () => {
    const r = fastestRoute(doc, '1', '4');
    if (!r.found) throw new Error('expected a route');
    expect(r.coords).toHaveLength(4);
    expect(r.lengthM).toBeCloseTo(615, -1);
    expect(r.timeS).toBeCloseTo(r.lengthM / (60 / 3.6), 0);
    expect(r.streets).toEqual(['Лермонтова', 'Игошина']);
  });

  test('reports a one-way cut with how much of the graph is reachable', () => {
    const r = fastestRoute(doc, '4', '1');
    expect(r).toEqual({ found: false, reason: 'unreachable', reachableNodes: 2 });
  });

  test('a node off the road graph is reported as such', () => {
    expect(fastestRoute(doc, '9', '1')).toMatchObject({ found: false, reason: 'not-on-graph' });
  });
});
