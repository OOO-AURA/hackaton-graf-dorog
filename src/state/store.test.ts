import { useEditor } from './store';
import { moveNode, toggleSignal } from '../osm/edit';
import { smallDoc } from '../test/docs';

describe('editor store history', () => {
  beforeEach(() => useEditor.getState().load(smallDoc(), 'test.osm'));

  test('undo and redo restore documents', () => {
    const { apply } = useEditor.getState();
    apply((d) => toggleSignal(d, '3'));
    expect(useEditor.getState().doc.nodes['3'].tags.highway).toBe('traffic_signals');
    useEditor.getState().undo();
    expect(useEditor.getState().doc.nodes['3'].tags.highway).toBeUndefined();
    useEditor.getState().redo();
    expect(useEditor.getState().doc.nodes['3'].tags.highway).toBe('traffic_signals');
  });

  test('no-op edits do not create history entries', () => {
    useEditor.getState().apply((d) => d);
    expect(useEditor.getState().past).toHaveLength(0);
  });

  test('a drag gesture is a single undo step', () => {
    const s = useEditor.getState();
    s.beginGesture();
    s.applyLive((d) => moveNode(d, '1', 104.1, 52));
    s.applyLive((d) => moveNode(d, '1', 104.2, 52));
    expect(useEditor.getState().past).toHaveLength(1);
    useEditor.getState().undo();
    expect(useEditor.getState().doc.nodes['1'].lon).toBe(104);
  });

  test('validation report is computed on demand and reset by edits', () => {
    expect(useEditor.getState().runValidation().issues.length).toBeGreaterThan(0);
    useEditor.getState().apply((d) => toggleSignal(d, '1'));
    expect(useEditor.getState().report).toBeNull();
  });
});
