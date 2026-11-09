import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addAllCordonConnectors, cordonEnds, cordonPairs, CORDON_NOTE } from './cordon';
import { parseOsm } from './parse';
import { serializeOsm } from './serialize';
import { validate } from './validate';

const xml = (body: string) => `<?xml version="1.0"?><osm version="0.6">
<bounds minlat="0" minlon="0" maxlat="0.01" maxlon="0.01"/>${body}</osm>`;

// Divided road cut by the west edge: eastbound enters at (0.0001, 0.005), westbound leaves at (0.0001, 0.0055).
const DIVIDED = xml(`
<node id="1" lat="0.0050" lon="0.0001"/><node id="2" lat="0.0050" lon="0.0050"/>
<node id="3" lat="0.0055" lon="0.0050"/><node id="4" lat="0.0055" lon="0.0001"/>
<node id="5" lat="0.0080" lon="0.0050"/>
<way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="primary"/><tag k="oneway" v="yes"/></way>
<way id="11"><nd ref="3"/><nd ref="4"/><tag k="highway" v="primary"/><tag k="oneway" v="yes"/></way>
<way id="12"><nd ref="2"/><nd ref="3"/><nd ref="5"/><tag k="highway" v="residential"/></way>`);

describe('cordon', () => {
  it('finds cut ends with their direction', () => {
    const ends = cordonEnds(parseOsm(DIVIDED));
    expect(ends.find((e) => e.nodeId === '1')?.flow).toBe('in');
    expect(ends.find((e) => e.nodeId === '4')?.flow).toBe('out');
    expect(ends.some((e) => e.nodeId === '5')).toBe(false);
  });

  it('pairs exit with entry and the connector closes the loop', () => {
    const doc = parseOsm(DIVIDED);
    expect(cordonPairs(doc)).toHaveLength(1);
    expect(validate(doc).issues.some((i) => i.kind === 'cordon')).toBe(true);
    const { doc: fixed, added } = addAllCordonConnectors(doc);
    expect(added).toBe(1);
    const connector = Object.values(fixed.ways).find((w) => w.tags.note === CORDON_NOTE)!;
    expect(connector.refs).toEqual(['4', '1']);
    expect(connector.tags).toMatchObject({ highway: 'primary', oneway: 'yes' });
    expect(validate(fixed).issues.filter((i) => i.kind === 'cordon' || i.kind === 'trap')).toEqual([]);
    expect(cordonPairs(fixed)).toEqual([]);
  });

  it('keeps a real oneway dead end inside the fragment as a trap', () => {
    const doc = parseOsm(xml(`
<node id="1" lat="0.005" lon="0.004"/><node id="2" lat="0.005" lon="0.005"/><node id="3" lat="0.005" lon="0.006"/>
<node id="4" lat="0.006" lon="0.005"/>
<way id="10"><nd ref="1"/><nd ref="2"/><nd ref="4"/><nd ref="1"/><tag k="highway" v="residential"/></way>
<way id="11"><nd ref="2"/><nd ref="3"/><tag k="highway" v="residential"/><tag k="oneway" v="yes"/></way>`));
    const kinds = validate(doc).issues.map((i) => i.kind);
    expect(kinds).toContain('trap');
    expect(kinds).not.toContain('cordon');
  });

  it('joins both ends of the bypass in the task example', () => {
    const doc = parseOsm(readFileSync(resolve(__dirname, '../test/example.osm'), 'utf8'));
    const pairs = cordonPairs(doc);
    const ways = pairs.map((p) => [p.from.wayId, p.to.wayId].sort().join('-'));
    expect(ways).toContain(['140857791', '140226968'].sort().join('-'));
    expect(ways).toContain(['677185648', '140226631'].sort().join('-'));
    const { doc: fixed } = addAllCordonConnectors(doc);
    expect(parseOsm(serializeOsm(fixed)).ways).toEqual(fixed.ways);
  });
});
