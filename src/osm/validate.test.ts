import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validate } from './validate';
import { addNode, connectCrossing, createWay, mergeNodes } from './edit';
import type { OsmDoc } from './types';
import { parseOsm } from './parse';
import { smallDoc } from '../test/docs';

describe('validate', () => {
  const doc = smallDoc();
  const report = validate(doc);
  const kinds = (r = report) => r.issues.map((i) => i.kind).sort();

  test('finds isolated parts, oneway traps and almost-touching nodes', () => {
    expect(kinds()).toEqual(['isolated', 'isolated', 'near-nodes', 'trap']);
    expect(report.issues.find((i) => i.kind === 'trap')?.wayIds).toEqual(['200']);
    expect(report.stats).toMatchObject({ ways: 4, components: 3, signals: 0 });
  });

  test('merge fix joins the broken intersection', () => {
    const near = report.issues.find((i) => i.kind === 'near-nodes')!;
    if (near.fix?.type !== 'merge') throw new Error('expected merge fix');
    expect(kinds(validate(mergeNodes(doc, near.fix.keep, near.fix.remove)))).toEqual(['isolated', 'trap']);
  });

  const withVerticalRoad = (tags: Record<string, string>): OsmDoc => {
    // a north-south road through x=104.0015 crossing way 100 (between nodes 2 and 3)
    const top = addNode(doc, 104.0015, 52.001);
    const bottom = addNode(top.doc, 104.0015, 51.9995);
    return createWay(bottom.doc, [top.id, bottom.id], tags).doc;
  };

  test('detects roads crossing without a node and fixes it', () => {
    const withCrossing = withVerticalRoad({ highway: 'residential' });
    const crossing = validate(withCrossing).issues.find((i) => i.kind === 'crossing');
    expect(crossing).toBeDefined();
    if (crossing?.fix?.type !== 'connect') throw new Error('expected connect fix');
    const fixed = connectCrossing(withCrossing, crossing.fix.a, crossing.fix.b, crossing.fix.at[0], crossing.fix.at[1]);
    expect(validate(fixed).issues.some((i) => i.kind === 'crossing')).toBe(false);
  });

  test('a bridge over a road is not a crossing error', () => {
    const bridged = withVerticalRoad({ highway: 'residential', bridge: 'yes' });
    expect(validate(bridged).issues.some((i) => i.kind === 'crossing')).toBe(false);
  });

  test('runs on the official example in reasonable time', () => {
    const example = parseOsm(readFileSync(resolve(__dirname, '../test/example.osm'), 'utf8'));
    const started = performance.now();
    const r = validate(example);
    expect(performance.now() - started).toBeLessThan(3000);
    expect(r.stats.ways).toBeGreaterThan(100);
    console.info('example.osm', r.stats, Object.entries(r.issues.reduce<Record<string, number>>((acc, i) => ({ ...acc, [i.kind]: (acc[i.kind] ?? 0) + 1 }), {})));
  });
});
