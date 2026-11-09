import { create } from 'zustand';
import { serializeOsm } from '../osm/serialize';
import { EMPTY_DOC, type OsmDoc } from '../osm/types';
import { loadXml } from './actions';
import { isDirty, useEditor } from './store';

/** Unsaved work written aside so a crash or a killed process does not lose it. */
export interface Draft {
  xml: string;
  fileName: string;
  filePath: string | null;
  savedAt: number;
  ways: number;
}

export interface DraftStore {
  read(): Promise<Draft | null>;
  write(d: Draft): Promise<void>;
  clear(): Promise<void>;
}

export const AUTOSAVE_MS = 30_000;
const DB = 'graf-dorog';
const STORE = 'draft';
const KEY = 'current';

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}

/** IndexedDB holds tens of megabytes, unlike localStorage, and works in the desktop webview too. */
export function indexedDbStore(): DraftStore | null {
  if (typeof indexedDB === 'undefined') return null;
  let db: Promise<IDBDatabase> | null = null;
  const open = () => (db ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
  const tx = async (mode: IDBTransactionMode) => (await open()).transaction(STORE, mode).objectStore(STORE);
  return {
    read: async () => ((await request((await tx('readonly')).get(KEY))) as Draft | undefined) ?? null,
    write: async (d) => { await request((await tx('readwrite')).put(d, KEY)); },
    clear: async () => { await request((await tx('readwrite')).delete(KEY)); },
  };
}

/** A draft found at start-up, offered on the start screen until restored, dropped or replaced. */
export const useDraft = create<{ found: Draft | null }>(() => ({ found: null }));

let store: DraftStore | null = null;
let written: OsmDoc | null = null;

/** One autosave step: writes the draft when the graph has unsaved edits, clears it once they are saved. */
export async function autosaveTick(s: DraftStore = store!): Promise<void> {
  const st = useEditor.getState();
  if (!isDirty(st) || !Object.keys(st.doc.nodes).length) {
    if (written) { written = null; await s.clear(); }
    return;
  }
  if (st.doc === written) return;
  const doc = st.doc;
  await s.write({ xml: serializeOsm(doc), fileName: st.fileName, filePath: st.filePath, savedAt: Date.now(), ways: Object.keys(doc.ways).length });
  written = doc;
}

export async function restoreDraft(): Promise<void> {
  const d = useDraft.getState().found;
  if (!d) return;
  loadXml(d.xml, d.fileName, d.filePath);
  // Restored edits are not on disk yet, so the graph stays marked as changed until it is saved.
  if (Object.keys(useEditor.getState().doc.nodes).length) useEditor.setState({ savedDoc: EMPTY_DOC });
  useDraft.setState({ found: null });
}

/** Forgets the draft: the user threw the edits away or chose not to restore them. */
export async function dropDraft(): Promise<void> {
  useDraft.setState({ found: null });
  written = null;
  await store?.clear();
}

/** Reads a draft left by a previous run and starts the 30 s autosave. */
export function startAutosave(s: DraftStore | null = indexedDbStore()): () => void {
  store = s;
  if (!s) return () => {};
  void s.read().then((d) => { if (d && !Object.keys(useEditor.getState().doc.nodes).length) useDraft.setState({ found: d }); }).catch(() => {});
  const timer = setInterval(() => { void autosaveTick(s).catch((err) => console.error('Autosave failed', err)); }, AUTOSAVE_MS);
  // Saving clears the draft at once; any newly loaded file hides the offer.
  const stop = useEditor.subscribe((st, prev) => {
    if (st.savedDoc !== prev.savedDoc && st.doc === st.savedDoc && written) { written = null; void s.clear(); }
    if (st.doc !== prev.doc && st.savedDoc !== prev.savedDoc && useDraft.getState().found && st.savedDoc !== EMPTY_DOC) useDraft.setState({ found: null });
  });
  return () => { clearInterval(timer); stop(); };
}
