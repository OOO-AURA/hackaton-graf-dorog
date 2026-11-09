import { create } from 'zustand';
import type { DrawPoint } from '../osm/draw';
import { EMPTY_DOC, type OsmDoc } from '../osm/types';
import { streetWays } from '../osm/street';

export type { DrawPoint };
import { validate, type ValidationReport } from '../osm/validate';

export type Mode = 'select' | 'draw' | 'insert' | 'signal';
/** `street` selects every drivable way named `id` (see osm/street.ts). */
export type Selection = { type: 'node' | 'way' | 'street'; id: string } | null;
export type Basemap = 'osm' | 'satellite' | 'none';


const HISTORY_LIMIT = 200;

interface EditorState {
  doc: OsmDoc;
  /** Document as it was last loaded or saved; differs from `doc` when there are unsaved edits. */
  savedDoc: OsmDoc;
  fileName: string;
  /** Absolute path on disk when running as the desktop app; null in the browser or for new files. */
  filePath: string | null;
  /** Name the file is saved under; the check server wants it to match the team name. */
  saveName: string;
  setSaveName: (name: string) => void;
  past: OsmDoc[];
  future: OsmDoc[];
  selection: Selection;
  mode: Mode;
  drawing: DrawPoint[];
  templateIndex: number;
  basemap: Basemap;
  report: ValidationReport | null;
  focusIssue: string | null;
  message: string | null;

  load: (doc: OsmDoc, fileName: string, filePath?: string | null) => void;
  /** `doc` is the document that was written; edits made while the save dialog was open stay unsaved. */
  markSaved: (fileName: string, filePath: string | null, doc: OsmDoc) => void;
  /** Applies an edit and records it in the undo history. */
  apply: (edit: (doc: OsmDoc) => OsmDoc) => void;
  /** Starts a continuous edit (e.g. dragging) — one undo step for the whole gesture. */
  beginGesture: () => void;
  /** Updates the document during a gesture without adding history entries. */
  applyLive: (edit: (doc: OsmDoc) => OsmDoc) => void;
  undo: () => void;
  redo: () => void;
  select: (selection: Selection) => void;
  setMode: (mode: Mode) => void;
  setDrawing: (points: DrawPoint[]) => void;
  setTemplate: (index: number) => void;
  setBasemap: (basemap: Basemap) => void;
  runValidation: () => ValidationReport;
  setFocusIssue: (id: string | null) => void;
  notify: (message: string | null) => void;
}

const pushPast = (past: OsmDoc[], doc: OsmDoc) => [...past, doc].slice(-HISTORY_LIMIT);

export const useEditor = create<EditorState>((set, get) => ({
  doc: EMPTY_DOC,
  savedDoc: EMPTY_DOC,
  fileName: 'graph.osm',
  filePath: null,
  saveName: 'hack-team10.osm',
  setSaveName: (saveName) => set({ saveName }),
  past: [],
  future: [],
  selection: null,
  mode: 'select',
  drawing: [],
  templateIndex: 2,
  basemap: 'osm',
  report: null,
  focusIssue: null,
  message: null,

  markSaved: (fileName, filePath, savedDoc) => set({ fileName, filePath, saveName: fileName, savedDoc }),
  load: (doc, fileName, filePath = null) => set({ doc, savedDoc: doc, fileName, filePath, past: [], future: [], selection: null, drawing: [], report: null, mode: 'select' }),
  apply: (edit) => {
    const { doc, past } = get();
    const next = edit(doc);
    if (next === doc) return;
    set({ doc: next, past: pushPast(past, doc), future: [], report: null });
  },
  beginGesture: () => set(({ doc, past }) => ({ past: pushPast(past, doc), future: [] })),
  applyLive: (edit) => set(({ doc }) => ({ doc: edit(doc), report: null })),
  undo: () => {
    const { past, doc, future } = get();
    if (!past.length) return;
    set({ doc: past[past.length - 1], past: past.slice(0, -1), future: [doc, ...future], report: null, drawing: [] });
  },
  redo: () => {
    const { past, doc, future } = get();
    if (!future.length) return;
    set({ doc: future[0], past: pushPast(past, doc), future: future.slice(1), report: null });
  },
  select: (selection) => set({ selection }),
  setMode: (mode) => set({ mode, drawing: [] }),
  setDrawing: (drawing) => set({ drawing }),
  setTemplate: (templateIndex) => set({ templateIndex }),
  setBasemap: (basemap) => set({ basemap }),
  runValidation: () => {
    const report = validate(get().doc);
    set({ report });
    return report;
  },
  setFocusIssue: (focusIssue) => set({ focusIssue }),
  notify: (message) => set({ message }),
}));

/** Selected way/node with existence check (it may have been deleted by undo). */
export function currentSelection(state: Pick<EditorState, 'doc' | 'selection'>): Selection {
  const { doc, selection } = state;
  if (!selection) return null;
  if (selection.type === 'street') return streetWays(doc, selection.id).length ? selection : null;
  const exists = selection.type === 'node' ? doc.nodes[selection.id] : doc.ways[selection.id];
  return exists ? selection : null;
}

/** True when the document has edits that are not written to disk yet. */
export const isDirty = (state: Pick<EditorState, 'doc' | 'savedDoc'>): boolean => state.doc !== state.savedDoc;
