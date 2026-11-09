import { commitDrawing } from './draw';
import { smallDoc } from '../test/docs';

describe('commitDrawing', () => {
  const doc = smallDoc();

  test('reuses existing nodes, splits roads at touched points and adds free nodes', () => {
    const { doc: d, wayId } = commitDrawing(doc, [
      { lon: 104.0, lat: 52.0, nodeId: '1' },
      { lon: 104.0005, lat: 51.998, wayId: '300' },
      { lon: 104.0005, lat: 51.997 },
    ], { highway: 'service' });
    const refs = d.ways[wayId].refs;
    expect(refs[0]).toBe('1');
    expect(d.ways['300'].refs).toEqual(['7', refs[1], '8']);
    expect(d.nodes[refs[2]].lat).toBe(51.997);
    expect(d.ways[wayId].tags).toEqual({ highway: 'service' });
  });

  test('two points on the same road get inserted into the right segments', () => {
    const { doc: d, wayId } = commitDrawing(doc, [
      { lon: 104.0025, lat: 52, wayId: '100' },
      { lon: 104.0005, lat: 52, wayId: '100' },
    ], { highway: 'service' });
    const [a, b] = d.ways[wayId].refs;
    expect(d.ways['100'].refs).toEqual(['1', b, '2', '3', a, '4']);
  });

  test('needs at least two distinct points', () => {
    expect(commitDrawing(doc, [{ lon: 0, lat: 0 }], {}).doc).toBe(doc);
    expect(commitDrawing(doc, [{ lon: 0, lat: 0, nodeId: '1' }, { lon: 0, lat: 0, nodeId: '1' }], {}).doc).toBe(doc);
  });
});
