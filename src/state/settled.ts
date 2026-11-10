import { useRef } from 'react';
import type { OsmDoc } from '../osm/types';
import { useEditor } from './store';
import { useUi } from './ui';

/**
 * The document as it was before the node being dragged started to move. Dragging changes the
 * document on every frame; what is costly to work out from it (lane markings, junction ribbons,
 * the 3D scene, lists in the panels) uses this one and is worked out once, when the node is let go.
 * The road being dragged and its nodes follow the pointer from the live document.
 */
export function useSettledDoc(): OsmDoc {
  const doc = useEditor((s) => s.doc);
  const dragging = useUi((s) => s.dragging);
  const settled = useRef(doc);
  if (!dragging) settled.current = doc;
  return settled.current;
}
