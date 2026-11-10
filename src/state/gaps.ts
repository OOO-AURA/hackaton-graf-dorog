import { create } from 'zustand';
import { useEditor } from './store';

/**
 * Critical gap and follow-up time of the approaches that give way, set by the engineer per
 * junction. No OSM tag carries them, so they are kept beside the file like the light programs.
 */

export interface Gaps { readonly tc: number; readonly tf: number }

interface GapState {
  gaps: Record<string, Record<string, Gaps>>;
  set: (nodeId: string, arm: string, gaps: Gaps | null) => void;
}

const KEY = 'graf.gaps:';
const load = (file: string) => { try { return JSON.parse(localStorage.getItem(KEY + file) ?? '{}') as GapState['gaps']; } catch { return {}; } };

export const useGaps = create<GapState>((set, get) => ({
  gaps: {},
  set: (nodeId, arm, gaps) => {
    const at = { ...(get().gaps[nodeId] ?? {}) };
    if (gaps) at[arm] = gaps; else delete at[arm];
    const next = { ...get().gaps, [nodeId]: at };
    try { localStorage.setItem(KEY + useEditor.getState().fileName, JSON.stringify(next)); } catch { /* storage off */ }
    set({ gaps: next });
  },
}));

let shown: string | null = null;
useEditor.subscribe((s) => {
  if (s.fileName === shown) return;
  shown = s.fileName;
  useGaps.setState({ gaps: load(s.fileName) });
});
