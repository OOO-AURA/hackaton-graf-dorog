import { create } from 'zustand';
import { useEditor } from '../state/store';
import type { Fc, MacroResult } from './compute';
import type { FlowsJob } from './flows.worker';
import { DEFAULT_BETA } from './purposes';

export { ISO_BANDS, VC_BANDS } from './compute';

interface MacroState {
  side: number;
  trips: number;
  /** Base β of the gravity model, 1/min. */
  beta: number;
  setBeta: (b: number) => void;
  /** Finds β for a target mean trip time and recalculates. */
  calibrate: (minutes: number) => Promise<void>;
  busy: boolean;
  error: string | null;
  result: MacroResult | null;
  iso: Fc | null;
  isoFrom: string | null;
  /** Hand-placed zone centroids; null means the grid. */
  points: Array<[number, number]> | null;
  /** Click-to-place mode on the map. */
  placing: boolean;
  /** True once a matrix cell was edited by hand; recalculation keeps the matrix. */
  odEdited: boolean;
  setPlacing: (on: boolean) => void;
  setPoints: (p: Array<[number, number]> | null) => void;
  setCell: (i: number, j: number, v: number) => void;
  resetOd: () => void;
  setSide: (n: number) => void;
  setTrips: (n: number) => void;
  run: (targetMinutes?: number) => Promise<void>;
  isochrone: (nodeId: string) => Promise<void>;
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
  beta: DEFAULT_BETA,
  setBeta: (beta) => set({ beta, odEdited: false }),
  calibrate: async (minutes) => {
    set({ odEdited: false });
    await get().run(minutes);
    const r = get().result;
    if (r?.calibrated === 'ok') set({ beta: r.beta });
  },
  busy: false,
  error: null,
  result: null,
  iso: null,
  isoFrom: null,
  points: null,
  placing: false,
  odEdited: false,
  setPlacing: (placing) => set(({ points, result }) => ({ placing, points: placing && !points && result?.zones.length ? result.zones.map((z) => z.lonlat) : points })),
  setPoints: (points) => set({ points: points?.length ? points : null, odEdited: false }),
  setCell: (i, j, v) => {
    const r = get().result;
    if (!r) return;
    const od = r.od.map((row, a) => row.map((x, b) => (a === i && b === j ? Math.max(0, Math.round(v)) : x)));
    set({ result: { ...r, od }, odEdited: true });
    void get().run();
  },
  resetOd: () => { set({ odEdited: false }); void get().run(); },
  setSide: (side) => set({ side, points: null, odEdited: false }),
  setTrips: (trips) => set({ trips, odEdited: false }),
  clear: () => set({ result: null, iso: null, isoFrom: null, error: null, odEdited: false }),
  run: async (targetMinutes) => {
    set({ busy: true, error: null });
    const { side, trips, points, odEdited, result, beta } = get();
    const r = await post({ kind: 'flows', doc: useEditor.getState().doc, opts: { side, trips, points, beta, targetMinutes: targetMinutes ?? null, od: odEdited ? result?.od : null } });
    set({ busy: false, error: r.error ?? null, result: (r.result as MacroResult) ?? get().result });
  },
  isochrone: async (nodeId) => {
    set({ busy: true, error: null });
    const r = await post({ kind: 'iso', doc: useEditor.getState().doc, nodeId });
    set({ busy: false, error: r.error ?? null, iso: (r.result as Fc) ?? null, isoFrom: r.result ? nodeId : null });
  },
}));
