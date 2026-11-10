import { create } from 'zustand';

/** Sizes and collapsed state of the docked panels; kept per user in localStorage. */
export interface PanelsState {
  navW: number;
  inspW: number;
  dockH: number;
  navOpen: boolean;
  inspOpen: boolean;
  set: (patch: Partial<Omit<PanelsState, 'set'>>) => void;
}

const KEY = 'graf.panels';
export const LIMITS = { navW: [248, 520], inspW: [260, 640], dockH: [96, 560] } as const;

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.round(Math.min(hi, Math.max(lo, v)));

function read(): Partial<PanelsState> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<PanelsState>; } catch { return {}; }
}

const saved = read();

export const usePanels = create<PanelsState>((set, get) => ({
  navW: clamp(saved.navW ?? 280, LIMITS.navW),
  inspW: clamp(saved.inspW ?? 340, LIMITS.inspW),
  dockH: clamp(saved.dockH ?? 200, LIMITS.dockH),
  navOpen: saved.navOpen ?? true,
  inspOpen: saved.inspOpen ?? true,
  set: (patch) => {
    const next = { ...patch };
    if (next.navW !== undefined) next.navW = clamp(next.navW, LIMITS.navW);
    if (next.inspW !== undefined) next.inspW = clamp(next.inspW, LIMITS.inspW);
    if (next.dockH !== undefined) next.dockH = clamp(next.dockH, LIMITS.dockH);
    set(next);
    const { navW, inspW, dockH, navOpen, inspOpen } = get();
    try { localStorage.setItem(KEY, JSON.stringify({ navW, inspW, dockH, navOpen, inspOpen })); } catch { /* private mode */ }
  },
}));
