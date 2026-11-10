import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { positiveInteger, safeInput, sanitizeDoc, unsafeTags } from './pipelineSafety';
import { parseOsm } from './parse';

const XML = `<osm version="0.6">
  <node id="1" lat="52" lon="104"/><node id="2" lat="52" lon="104.001"/><node id="3" lat="52.001" lon="104.001"/><node id="4" lat="52.001" lon="104"/>
  <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="primary"/><tag k="lanes" v="2.5"/><tag k="lanes:forward" v="0"/></way>
  <way id="11"><nd ref="2"/><nd ref="3"/><tag k="highway" v="footway"/><tag k="layer" v="yes"/></way>
  <way id="12"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><nd ref="1"/><tag k="building" v="yes"/><tag k="height" v="10"/><tag k="roof:height" v="12"/><tag k="min_height" v="3"/><tag k="building:colour" v="#zzz"/></way>
  <way id="13"><nd ref="3"/><nd ref="4"/><tag k="highway" v="residential"/><tag k="lanes" v="2"/><tag k="layer" v="-1"/></way>
</osm>`;

describe('values that crash the Webots importer', () => {
  const doc = parseOsm(XML);

  test('finds lanes, layer, colour and height problems, and nothing on a valid road', () => {
    const found = unsafeTags(doc).map((p) => `${p.wayId}:${p.key}`).sort();
    expect(found).toEqual(['10:lanes', '10:lanes:forward', '11:layer', '12:building:colour', '12:min_height', '12:roof:height']);
  });

  test('the fix keeps the intent where it can', () => {
    const fixed = sanitizeDoc(doc);
    expect(fixed.ways['10'].tags).toMatchObject({ lanes: '3' });
    expect(fixed.ways['10'].tags['lanes:forward']).toBeUndefined();
    expect(fixed.ways['11'].tags.layer).toBeUndefined();
    // The roof higher than the building goes; min_height is valid again and stays.
    expect(fixed.ways['12'].tags).toEqual({ building: 'yes', height: '10', min_height: '3' });
    expect(unsafeTags(fixed)).toHaveLength(0);
    expect(sanitizeDoc(fixed)).toBe(fixed);
  });

  test('input guard for the inspector fields', () => {
    expect(safeInput('lanes', '2.4')).toBe('2');
    expect(safeInput('lanes', '0')).toBeNull();
    expect(safeInput('lanes', ' ')).toBeNull();
    expect(safeInput('layer', '1;2')).toBe('1');
    expect(safeInput('maxspeed', '60')).toBe('60');
    expect(positiveInteger('2;3')).toBe('2');
  });

  test('the task fragment and the team file are safe', () => {
    for (const file of ['../test/example.osm', '../../submission/hack-team10.osm']) {
      expect(unsafeTags(parseOsm(readFileSync(resolve(__dirname, file), 'utf8')))).toEqual([]);
    }
  });
});
