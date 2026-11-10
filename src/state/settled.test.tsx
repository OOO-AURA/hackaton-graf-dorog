import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { parseOsm } from '../osm/parse';
import { moveNode } from '../osm/edit';
import { useEditor } from './store';
import { useUi } from './ui';
import { useSettledDoc } from './settled';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Lon() {
  return <span>{useSettledDoc().nodes['1'].lon}</span>;
}

test('while a node is dragged the settled document stays put, and catches up when it is let go', () => {
  act(() => useEditor.getState().load(parseOsm('<osm version="0.6"><node id="1" lat="52" lon="104"/></osm>'), 't.osm'));
  const mount = document.createElement('div');
  const root = createRoot(mount);
  act(() => root.render(<Lon />));
  expect(mount.textContent).toBe('104');

  act(() => {
    useUi.getState().setDragging(true);
    useEditor.getState().applyLive((d) => moveNode(d, '1', 104.5, 52));
  });
  expect(mount.textContent).toBe('104');

  act(() => useUi.getState().setDragging(false));
  expect(mount.textContent).toBe('104.5');
  act(() => root.unmount());
});
