import { BUILDING_TEMPLATES } from '../osm/buildingShape';
import { placeTemplate } from '../osm/buildingEdit';
import { EMPTY_DOC } from '../osm/types';
import { buildingHandles } from './useBuildingEditing';

test('a building gets a handle on every corner and side, and one to turn it', () => {
  const { doc, id } = placeTemplate(EMPTY_DOC, [104.26, 52.26], BUILDING_TEMPLATES[1], 20);
  const kinds = buildingHandles(doc, id, 2).features.map((f) => (f as { properties: { kind: string; picked?: boolean } }).properties);
  expect(kinds.filter((k) => k.kind === 'corner')).toHaveLength(4);
  expect(kinds.filter((k) => k.kind === 'mid')).toHaveLength(4);
  expect(kinds.filter((k) => k.kind === 'edge')).toHaveLength(4);
  expect(kinds.filter((k) => k.kind === 'rotate')).toHaveLength(1);
  expect(kinds.filter((k) => k.picked)).toHaveLength(1);
  expect(buildingHandles(doc, null, null).features).toHaveLength(0);
});
