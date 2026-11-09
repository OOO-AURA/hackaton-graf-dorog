import { describe, expect, it } from 'vitest';
import { computeFlows } from '../macro/compute';
import { contextGeoJson, nodesGeoJson, roadsGeoJson } from '../map/geojson';
import { transitRoutes } from '../transit/routes';
import { toMatsimNetwork } from './matsim';
import { OsmParseError, parseOsm, parseOsmChecked } from './parse';
import { serializeOsm } from './serialize';
import { validate } from './validate';

const BROKEN = `<?xml version="1.0"?>
<osm version="0.6">
  <bounds minlat="52.25" minlon="104.25" maxlat="52.27" maxlon="104.27"/>
  <node id="1" lat="52.26" lon="104.26"/>
  <node id="2" lat="52.261" lon="104.261"/>
  <node id="3" lat="abc" lon="104.262"/>
  <node id="4" lat="52.262"/>
  <node id="5" lat="52.263" lon="104.263"/>
  <way id="10"><nd ref="1"/><nd ref="2"/><nd ref="99"/><tag k="highway" v="primary"/></way>
  <way id="11"><nd ref="3"/><nd ref="4"/><tag k="highway" v="residential"/></way>
  <way id="12"><nd ref="5"/><tag k="highway" v="residential"/></way>
  <way id="13"><nd ref="2"/><nd ref="5"/><nd ref="2"/><tag k="highway" v="service"/><tag k="lanes" v="много"/><tag k="maxspeed" v="RU:urban"/></way>
  <way id="14"><tag k="building" v="yes"/></way>
  <relation id="20"><member type="way" ref="404" role=""/><member type="node" ref="1" role="stop"/><tag k="type" v="route"/><tag k="route" v="bus"/></relation>
</osm>`;

describe('broken .osm files', () => {
  it('rejects text that is not OSM with a readable message', () => {
    expect(() => parseOsm('')).toThrow(OsmParseError);
    expect(() => parseOsm('<osm><node id="1" lat="52"')).toThrow(OsmParseError);
    expect(() => parseOsm('<gpx/>')).toThrow(/osm/);
  });

  it('opens a file with dangling refs, bad coordinates and one-node ways and runs every step on it', () => {
    const doc = parseOsm(BROKEN);
    expect(doc.nodes['3']).toBeUndefined();
    expect(doc.ways['10'].refs).toEqual(['1', '2']);
    expect(doc.ways['11']).toBeUndefined();
    expect(() => validate(doc)).not.toThrow();
    expect(() => roadsGeoJson(doc)).not.toThrow();
    expect(() => nodesGeoJson(doc, '10')).not.toThrow();
    expect(() => contextGeoJson(doc)).not.toThrow();
    expect(() => transitRoutes(doc)).not.toThrow();
    expect(() => toMatsimNetwork(doc)).not.toThrow();
    expect(() => computeFlows(doc, { side: 2, trips: 100 })).not.toThrow();
    expect(parseOsm(serializeOsm(doc)).ways['13'].refs).toEqual(['2', '5', '2']);
  });

  it('reports what was repaired, and nothing for the task example', async () => {
    expect(parseOsmChecked(BROKEN).repairs).toEqual({ badNodes: 2, danglingRefs: 3, droppedWays: 1 });
    const { readFileSync } = await import('node:fs');
    expect(parseOsmChecked(readFileSync('public/example.osm', 'utf8')).repairs).toEqual({ badNodes: 0, danglingRefs: 0, droppedWays: 0 });
  });

  it('opens an empty <osm/>', () => {
    const doc = parseOsm('<osm version="0.6"/>');
    expect(validate(doc).issues).toEqual([]);
    expect(() => computeFlows(doc, { side: 2, trips: 100 })).not.toThrow();
  });
});
