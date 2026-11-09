import {
  addNode, connectCrossing, createWay, deleteNode, deleteWay, flipDirection, insertNodeInWay,
  mergeNodes, moveNode, reverseWay, setWayTag, splitWay, toggleSignal,
} from './edit';
import { direction, reverseWayTags } from './tags';
import { serializeOsm } from './serialize';
import { smallDoc } from '../test/docs';

describe('edit operations', () => {
  const doc = smallDoc();

  test('never mutate the source document', () => {
    const frozen = Object.freeze(doc);
    moveNode(frozen, '1', 0, 0);
    expect(doc.nodes['1'].lon).toBe(104);
  });

  test('new objects get fresh positive ids', () => {
    const { doc: d, id } = addNode(doc, 104.5, 52.5);
    expect(Number(id)).toBeGreaterThan(900);
    const w = createWay(d, ['1', id], { highway: 'service' });
    expect(Number(w.id)).toBe(Number(id) + 1);
  });

  test('deleting a node removes it from ways and drops degenerate ways', () => {
    const d = deleteNode(doc, '8');
    expect(d.ways['300']).toBeUndefined();
    expect(d.deleted).toMatchObject({ 'node:8': true, 'way:300': true });
    expect(deleteNode(doc, '2').ways['100'].refs).toEqual(['1', '3', '4']);
  });

  test('deleted ways disappear from relations on export', () => {
    expect(serializeOsm(deleteWay(doc, '100'))).not.toContain('ref="100"');
  });

  test('reversing a way keeps its meaning: lanes forward/backward swap', () => {
    const w = reverseWay(doc, '100').ways['100'];
    expect(w.refs).toEqual(['4', '3', '2', '1']);
    expect(w.tags).toMatchObject({ 'lanes:forward': '1', 'lanes:backward': '2' });
    expect(reverseWayTags({ oneway: '-1' })).toEqual({ oneway: 'yes' });
  });

  test('flipping direction changes which way traffic goes', () => {
    const d = flipDirection(doc, '200');
    expect(direction(d.ways['200'].tags)).toBe('backward');
    expect(flipDirection(doc, '100')).toEqual(doc);
  });

  test('sets and removes tags', () => {
    const d = setWayTag(setWayTag(doc, '100', 'bridge', 'yes'), '100', 'layer', '1');
    expect(d.ways['100'].tags).toMatchObject({ bridge: 'yes', layer: '1' });
    expect(setWayTag(d, '100', 'bridge', null).ways['100'].tags.bridge).toBeUndefined();
  });

  test('toggles a traffic signal on a node', () => {
    const d = toggleSignal(doc, '3');
    expect(d.nodes['3'].tags.highway).toBe('traffic_signals');
    expect(toggleSignal(d, '3').nodes['3'].tags.highway).toBeUndefined();
  });

  test('inserts a node into a segment', () => {
    const { doc: d, id } = insertNodeInWay(doc, '300', 0, 104.0005, 51.998);
    expect(d.ways['300'].refs).toEqual(['7', id, '8']);
    expect(insertNodeInWay(doc, '300', 5, 0, 0).id).toBe('');
  });

  test('splits a way and adds the new part to the same relations', () => {
    const { doc: d, newWayId } = splitWay(doc, '100', '3');
    expect(d.ways['100'].refs).toEqual(['1', '2', '3']);
    expect(d.ways[newWayId].refs).toEqual(['3', '4']);
    expect(d.ways[newWayId].tags).toEqual(doc.ways['100'].tags);
    expect(d.relations['900'].members.map((m) => m.ref)).toEqual(['100', newWayId]);
    expect(splitWay(doc, '100', '1').newWayId).toBe('');
  });

  test('merges two nodes into one intersection', () => {
    const d = mergeNodes(doc, '8', '9');
    expect(d.nodes['9']).toBeUndefined();
    expect(d.ways['400'].refs).toEqual(['8', '10']);
  });

  test('connects two crossing ways with a shared node', () => {
    const d = connectCrossing(doc, { wayId: '100', index: 0 }, { wayId: '300', index: 0 }, 104.0005, 52);
    const shared = d.ways['100'].refs[1];
    expect(d.ways['300'].refs).toEqual(['7', shared, '8']);
  });

  test('operations on unknown ids are no-ops', () => {
    expect(moveNode(doc, 'x', 0, 0)).toBe(doc);
    expect(deleteNode(doc, 'x')).toBe(doc);
    expect(deleteWay(doc, 'x')).toBe(doc);
    expect(reverseWay(doc, 'x')).toBe(doc);
    expect(toggleSignal(doc, 'x')).toBe(doc);
    expect(mergeNodes(doc, '1', '1')).toBe(doc);
  });
});

describe('direction', () => {
  test.each([
    [{ oneway: 'yes' }, 'forward'], [{ oneway: '-1' }, 'backward'], [{ oneway: 'no', junction: 'roundabout' }, 'both'],
    [{ junction: 'roundabout' }, 'forward'], [{ highway: 'motorway' }, 'forward'], [{}, 'both'],
  ])('%j → %s', (tags, expected) => {
    expect(direction(tags)).toBe(expected);
  });
});
