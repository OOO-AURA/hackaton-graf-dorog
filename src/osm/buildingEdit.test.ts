import { buildingHeight } from './height';
import { BUILDING_TEMPLATES, insertVertex, orientedBox, type P } from './buildingShape';
import { deleteBuilding, duplicateBuilding, localOutline, outlineOf, placeTemplate, reshape } from './buildingEdit';
import { EMPTY_DOC } from './types';

const [small, medium, large] = BUILDING_TEMPLATES;
const at: [number, number] = [104.26, 52.26];

describe('buildings in the document', () => {
  test('a template becomes a closed way with standard tags and the right size', () => {
    const { doc, id } = placeTemplate(EMPTY_DOC, at, medium, 30);
    const way = doc.ways[id];
    expect(way.refs).toHaveLength(5);
    expect(way.refs[0]).toBe(way.refs[4]);
    expect(way.tags).toEqual({ building: 'yes', 'building:levels': '5', height: '15' });
    const box = orientedBox(localOutline(doc, id)!.ring);
    expect(box.width).toBeCloseTo(20, 1);
    expect(box.length).toBeCloseTo(40, 1);
    expect(box.angle).toBeCloseTo(30, 1);
  });

  test('the three templates are 2, 5 and 9 storeys high in Webots terms', () => {
    const heights = [small, medium, large].map((t) => {
      const placed = placeTemplate(EMPTY_DOC, at, t, 0);
      return buildingHeight(placed.doc.ways[placed.id].tags);
    });
    expect(heights.map((h) => [h.levels, h.height])).toEqual([[2, 6], [5, 15], [9, 27]]);
  });

  test('reshaping adds nodes for new corners and drops the ones no longer used', () => {
    const { doc, id } = placeTemplate(EMPTY_DOC, at, small, 0);
    const nodes = Object.keys(doc.nodes).length;
    const grown = reshape(doc, id, (r) => insertVertex(r, 1, [(r[1][0] + r[2][0]) / 2 + 3, (r[1][1] + r[2][1]) / 2] as P));
    expect(outlineOf(grown, id)!.refs).toHaveLength(5);
    expect(Object.keys(grown.nodes)).toHaveLength(nodes + 1);
    const shrunk = reshape(grown, id, (r) => r.filter((_, i) => i !== 2));
    expect(Object.keys(shrunk.nodes)).toHaveLength(nodes);
  });

  test('a copy stands on its own nodes; deleting takes its nodes along', () => {
    const { doc, id } = placeTemplate(EMPTY_DOC, at, small, 0);
    const copy = duplicateBuilding(doc, id, [20, 0]);
    expect(copy.id).not.toBe(id);
    const shared = copy.doc.ways[copy.id].refs.filter((r) => doc.ways[id].refs.includes(r));
    expect(shared).toHaveLength(0);
    const gone = deleteBuilding(copy.doc, copy.id);
    expect(gone.ways[copy.id]).toBeUndefined();
    expect(Object.keys(gone.nodes)).toHaveLength(Object.keys(doc.nodes).length);
  });
});
