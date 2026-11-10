import { isBuilding } from '../osm/building';
import { addBuilding, duplicateBuilding, localOutline, metres, reshape, type LonLat } from '../osm/buildingEdit';
import { centroid, orientedBox, resize, rotate, squareUp, translate, type P } from '../osm/buildingShape';
import type { Tags } from '../osm/types';
import { currentSelection, useEditor } from './store';

/**
 * Actions on the selected building from the inspector and the keyboard: size and turn in
 * numbers, square corners, copies (Ctrl+D next to it, Ctrl+C / Ctrl+V at the cursor).
 */

/** Where the mouse last was over the map; a pasted building goes there. */
let pointer: LonLat | null = null;
export const setPointer = (p: LonLat) => { pointer = p; };

let clipboard: { outline: P[]; lat: number; tags: Tags } | null = null;

/** Gap between a building and its copy, metres. */
const COPY_GAP = 5;

export function selectedBuildingId(): string | null {
  const s = useEditor.getState();
  const sel = currentSelection(s);
  if (sel?.type !== 'way') return null;
  const w = s.doc.ways[sel.id];
  return w && isBuilding(w.tags) ? w.id : null;
}

const change = (fn: (ring: P[]) => P[]) => {
  const id = selectedBuildingId();
  if (id) useEditor.getState().apply((d) => reshape(d, id, fn));
};

export const setBuildingSize = (width: number, length: number) => {
  if (width > 0.5 && length > 0.5) change((r) => resize(r, width, length));
};

export const setBuildingAngle = (angle: number) => change((r) => rotate(r, angle - orientedBox(r).angle));

export const squareUpSelected = () => change(squareUp);

/** A copy right next to the building, across its short side, selected. */
export function duplicateSelected(): void {
  const id = selectedBuildingId();
  const s = useEditor.getState();
  const local = id ? localOutline(s.doc, id) : null;
  if (!id || !local) return;
  const box = orientedBox(local.ring);
  const across = ((box.angle + 90) * Math.PI) / 180;
  const step = box.width + COPY_GAP;
  let created = '';
  s.apply((d) => {
    const r = duplicateBuilding(d, id, [Math.sin(across) * step, Math.cos(across) * step]);
    created = r.id;
    return r.doc;
  });
  if (created) s.select({ type: 'way', id: created });
}

export function copySelected(): boolean {
  const id = selectedBuildingId();
  const s = useEditor.getState();
  const local = id ? localOutline(s.doc, id) : null;
  if (!id || !local) return false;
  const c = centroid(local.ring);
  clipboard = { outline: translate(local.ring, [-c[0], -c[1]]), lat: s.doc.nodes[s.doc.ways[id].refs[0]].lat, tags: s.doc.ways[id].tags };
  s.notify('Здание скопировано: Ctrl+V поставит копию под курсором');
  return true;
}

export function pasteBuilding(): boolean {
  if (!clipboard) return false;
  const s = useEditor.getState();
  const at = pointer;
  if (!at) return false;
  const m = metres(at[1]);
  const c = m.to(at);
  const ring = clipboard.outline.map((p): P => [p[0] + c[0], p[1] + c[1]]).map(m.back);
  let created = '';
  const tags = clipboard.tags;
  s.apply((d) => {
    const r = addBuilding(d, ring, tags);
    created = r.id;
    return r.doc;
  });
  if (created) s.select({ type: 'way', id: created });
  return true;
}
