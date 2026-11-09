import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseOsm, OsmParseError } from './parse';
import { serializeOsm } from './serialize';

const exampleXml = readFileSync(resolve(__dirname, '../test/example.osm'), 'utf8');

describe('parse + serialize', () => {
  const doc = parseOsm(exampleXml);

  test('reads every object of the official example', () => {
    expect(Object.keys(doc.nodes)).toHaveLength(6089);
    expect(Object.keys(doc.ways)).toHaveLength(1392);
    expect(Object.keys(doc.relations).length).toBeGreaterThan(0);
    expect(doc.bounds).toMatchObject({ minlat: '52.2511300' });
  });

  test('round trip is lossless', () => {
    const again = parseOsm(serializeOsm(doc));
    expect(again.nodes).toEqual(doc.nodes);
    expect(again.ways).toEqual(doc.ways);
    expect(again.relations).toEqual(doc.relations);
    expect(again.bounds).toEqual(doc.bounds);
  });

  test('new ids start above every existing id', () => {
    const max = Math.max(...Object.keys(doc.nodes).map(Number), ...Object.keys(doc.ways).map(Number));
    expect(doc.nextId).toBeGreaterThan(max);
  });

  test('escapes special characters in tags', () => {
    const xml = '<osm version="0.6"><node id="1" lat="1" lon="2"><tag k="name" v="A &amp; &quot;B&quot; &lt;C&gt;"/></node></osm>';
    const out = serializeOsm(parseOsm(xml));
    expect(out).toContain('v="A &amp; &quot;B&quot; &lt;C&gt;"');
    expect(parseOsm(out).nodes['1'].tags.name).toBe('A & "B" <C>');
  });

  test('drops only relation members deleted in the editor, keeps ones outside the extract', () => {
    const xml = '<osm version="0.6"><node id="1" lat="1" lon="2"/><relation id="9"><member type="node" ref="1" role="a"/><member type="way" ref="404" role=""/></relation></osm>';
    const parsed = parseOsm(xml);
    expect(serializeOsm(parsed)).toContain('ref="404"');
    const { ['1']: _gone, ...nodes } = parsed.nodes;
    const out = serializeOsm({ ...parsed, nodes, deleted: { 'node:1': true } });
    expect(out).not.toContain('type="node" ref="1"');
    expect(out).toContain('ref="404"');
  });

  test('rejects invalid input with a readable error', () => {
    expect(() => parseOsm('<oops')).toThrow(OsmParseError);
    expect(() => parseOsm('<root/>')).toThrow('<osm>');
  });
});
