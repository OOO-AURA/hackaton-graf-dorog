import { diffFeatures, diffMarkdown, docDiff, isEmptyDiff, tagChanges } from './diff';
import { addNode, createWay, deleteWay, moveNode, setWayTag, toggleSignal } from './edit';
import { smallDoc } from '../test/docs';

describe('docDiff', () => {
  const base = smallDoc();

  test('an untouched document has no changes', () => {
    expect(isEmptyDiff(docDiff(base, base))).toBe(true);
  });

  test('reports added, deleted, reshaped and retagged ways with tag details', () => {
    let d = setWayTag(base, '100', 'lanes', '4');
    d = deleteWay(d, '300');
    const n = addNode(d, 104.004, 52);
    d = createWay(n.doc, ['4', n.id], { highway: 'service' }).doc;
    d = moveNode(d, '2', 104.0011, 52);
    d = toggleSignal(d, '3');
    const diff = docDiff(base, d);
    const kinds = Object.fromEntries(diff.ways.map((w) => [w.id, w.kind]));
    expect(kinds['100']).toBe('tags');
    expect(kinds['300']).toBe('deleted');
    expect(Object.values(kinds)).toContain('added');
    expect(diff.ways.find((w) => w.id === '100')!.tags).toEqual([['lanes', null, '4']]);
    expect(diff.nodes.find((x) => x.id === '3')).toMatchObject({ kind: 'tags', tags: [['highway', null, 'traffic_signals']] });
    expect(diff.nodes.find((x) => x.id === '2')).toMatchObject({ kind: 'moved' });
  });

  test('separately opened copies of the same file have no changes', async () => {
    const { parseOsm } = await import('./parse');
    const { SMALL_OSM } = await import('../test/docs');
    expect(isEmptyDiff(docDiff(parseOsm(SMALL_OSM), parseOsm(SMALL_OSM)))).toBe(true);
  });

  test('tag changes list removed, added and changed keys', () => {
    expect(tagChanges({ a: '1', b: '2' }, { b: '3', c: '4' })).toEqual([['a', '1', null], ['b', '2', '3'], ['c', null, '4']]);
  });

  test('markdown and map features describe the same changes', () => {
    const d = deleteWay(setWayTag(base, '100', 'maxspeed', '60'), '300');
    const diff = docDiff(base, d);
    const md = diffMarkdown(diff, base, d, 'team.osm');
    expect(md).toContain('## Линии: удалено (1)');
    expect(md).toContain('`maxspeed`: — → 60');
    const kinds = (diffFeatures(diff, base, d) as Array<{ properties: { kind: string } }>).map((f) => f.properties.kind).sort();
    expect(kinds).toEqual(['deleted', 'tags']);
  });
});
