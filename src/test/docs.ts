import { parseOsm } from '../osm/parse';

/**
 * Small road network:
 *   1 — 2 — 3 — 4   way 100 primary, two-way
 *           |
 *           5 — 6   way 200 residential, oneway
 *   7 — 8           way 300 residential, crosses nothing; 9 is 0.5 m from 8 but not connected (way 400 9—10)
 * Relation 900 (bus route) contains way 100.
 */
export const SMALL_OSM = `<osm version="0.6">
  <node id="1" lat="52.0000" lon="104.0000"/>
  <node id="2" lat="52.0000" lon="104.0010"/>
  <node id="3" lat="52.0000" lon="104.0020"/>
  <node id="4" lat="52.0000" lon="104.0030"/>
  <node id="5" lat="51.9990" lon="104.0020"/>
  <node id="6" lat="51.9990" lon="104.0030"/>
  <node id="7" lat="51.9980" lon="104.0000"/>
  <node id="8" lat="51.9980" lon="104.0010"/>
  <node id="9" lat="51.9980" lon="104.001007"/>
  <node id="10" lat="51.9980" lon="104.0020"/>
  <way id="100"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><tag k="highway" v="primary"/><tag k="lanes:forward" v="2"/><tag k="lanes:backward" v="1"/></way>
  <way id="200"><nd ref="3"/><nd ref="5"/><nd ref="6"/><tag k="highway" v="residential"/><tag k="oneway" v="yes"/></way>
  <way id="300"><nd ref="7"/><nd ref="8"/><tag k="highway" v="residential"/></way>
  <way id="400"><nd ref="9"/><nd ref="10"/><tag k="highway" v="residential"/></way>
  <relation id="900"><member type="way" ref="100" role=""/><tag k="route" v="bus"/></relation>
</osm>`;

export const smallDoc = () => parseOsm(SMALL_OSM);
