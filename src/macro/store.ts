import { create } from 'zustand';
import { useEditor } from '../state/store';
import type { Fc, MacroResult } from './compute';
import type { FlowsJob } from './flows.worker';

export { ISO_BANDS, VC_BANDS } from './compute';

interface MacroState {
  side: number;
  trips: number;
  busy: boolean;
  error: string | null;
  result: MacroResult | null;
  iso: Fc | null;
  isoFrom: string | null;
  setSide: (n: number) => void;
  setTrips: (n: number) => void;
  run: () => void;
  isochrone: (nodeId: string) => void;
  clear: () => void;
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (r: { result?: unknown; error?: string }) => void>();

/** Runs a job in the background worker so the map stays responsive on big graphs. */
function post(job: FlowsJob extends infer J ? (J extends FlowsJob ? Omit<J, 'id'> : never) : never): Promise<{ result?: unknown; error?: string }> {
  if (!worker) {
    worker = new Worker(new URL('./flows.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => { pending.get(e.data.id)?.(e.data); pending.delete(e.data.id); };
  }
  const id = ++seq;
  return new Promise((resolve) => { pending.set(id, resolve); worker!.postMessage({ ...job, id }); });
}

export const useMacro = create<MacroState>((set, get) => ({
  side: 3,
  trips: 4000,
  busy: false,
  error: null,
  result: null,
  iso: null,
  isoFrom: null,
  setSide: (side) => set({ side }),
  setTrips: (trips) => set({ trips }),
  clear: () => set({ result: null, iso: null, isoFrom: null, error: null }),
  run: async () => {
    set({ busy: true, error: null });
    const r = await post({ kind: 'flows', doc: useEditor.getState().doc, side: get().side, trips: get().trips });
    set({ busy: false, error: r.error ?? null, result: (r.result as MacroResult) ?? get().result });
  },
  isochrone: async (nodeId) => {
    set({ busy: true, error: null });
    const r = await post({ kind: 'iso', doc: useEditor.getState().doc, nodeId });
    set({ busy: false, error: r.error ?? null, iso: (r.result as Fc) ?? null, isoFrom: r.result ? nodeId : null });
  },
}));
