import { create } from 'zustand';

/** Files opened or saved lately in the desktop app, newest first; the start card offers them. */

export interface RecentFile { readonly path: string; readonly name: string; readonly at: number }

const KEY = 'graf.recent-files';
const MAX = 6;

function read(): RecentFile[] {
  try { return (JSON.parse(localStorage.getItem(KEY) ?? '[]') as RecentFile[]).filter((f) => f && typeof f.path === 'string'); } catch { return []; }
}

export const useRecent = create<{ files: RecentFile[]; remember: (path: string, name: string) => void; forget: (path: string) => void }>((set, get) => ({
  files: read(),
  remember: (path, name) => {
    const files = [{ path, name, at: Date.now() }, ...get().files.filter((f) => f.path !== path)].slice(0, MAX);
    try { localStorage.setItem(KEY, JSON.stringify(files)); } catch { /* storage off */ }
    set({ files });
  },
  forget: (path) => {
    const files = get().files.filter((f) => f.path !== path);
    try { localStorage.setItem(KEY, JSON.stringify(files)); } catch { /* storage off */ }
    set({ files });
  },
}));
