import { create } from 'zustand';
import { bundleFeatures, bundleFor, type FlowBundle } from './bundle';
import { useMacro } from './store';
import { useEditor } from '../state/store';

interface BundleState {
  bundle: FlowBundle | null;
  features: unknown[];
  error: string | null;
  /** Builds the bundle of the road from the current macro result. */
  show: (wayId: string) => void;
  clear: () => void;
}

export const useBundle = create<BundleState>((set) => ({
  bundle: null,
  features: [],
  error: null,
  show: (wayId) => {
    const result = useMacro.getState().result;
    if (!result) { set({ error: 'Сначала распределите потоки', bundle: null, features: [] }); return; }
    const built = bundleFor(useEditor.getState().doc, result, wayId);
    if (!built) { set({ error: 'Граф изменился после расчёта потоков: пересчитайте потоки', bundle: null, features: [] }); return; }
    set({ bundle: built.bundle, features: bundleFeatures(built.net, built.bundle), error: null });
  },
  clear: () => set({ bundle: null, features: [], error: null }),
}));

// A new assignment or a cleared result makes the old bundle stale.
useMacro.subscribe((s, prev) => { if (s.result !== prev.result) useBundle.getState().clear(); });
