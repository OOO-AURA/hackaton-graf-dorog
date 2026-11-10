import { create } from 'zustand';

/**
 * Own traffic: flows the user knows from the city, each from one place to another with so many
 * vehicles an hour, instead of random trips. They go to SUMO as an OD matrix with a zone at every
 * end, so each flow takes the quickest route the network offers between its two ends.
 */

export interface FlowEnd { readonly lon: number; readonly lat: number }

export interface CustomFlow {
  readonly id: number;
  readonly from: FlowEnd;
  readonly to: FlowEnd;
  /** Vehicles an hour. */
  readonly vph: number;
  readonly label: string;
}

/** Where the next click on the map goes while a flow is being placed. */
export type FlowPick = 'from' | 'to' | null;

export const DEFAULT_VPH = 300;
export const MAX_VPH = 5000;
const STORAGE_KEY = 'graf-dorog.custom-flows';

interface FlowsState {
  flows: CustomFlow[];
  pick: FlowPick;
  pendingFrom: FlowEnd | null;
  startPick: () => void;
  cancelPick: () => void;
  /** A click on the map while placing: the start, then the end of a new flow. */
  place: (at: FlowEnd) => void;
  update: (id: number, patch: Partial<Pick<CustomFlow, 'vph' | 'label'>>) => void;
  remove: (id: number) => void;
  clear: () => void;
}

function load(): CustomFlow[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? (JSON.parse(raw) as CustomFlow[]) : [];
    return Array.isArray(list) ? list.filter((f) => f && Number.isFinite(f.vph) && f.from && f.to) : [];
  } catch {
    return [];
  }
}

function save(flows: readonly CustomFlow[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(flows)); } catch { /* storage may be off */ }
}

const clampVph = (v: number) => Math.max(1, Math.min(MAX_VPH, Math.round(v)));

export const useCustomFlows = create<FlowsState>((set, get) => {
  const commit = (flows: CustomFlow[]) => { save(flows); return { flows }; };
  return {
    flows: load(),
    pick: null,
    pendingFrom: null,
    startPick: () => set({ pick: 'from', pendingFrom: null }),
    cancelPick: () => set({ pick: null, pendingFrom: null }),
    place: (at) => {
      const { pick, pendingFrom, flows } = get();
      if (pick === 'from') { set({ pick: 'to', pendingFrom: at }); return; }
      if (pick !== 'to' || !pendingFrom) return;
      const id = Math.max(0, ...flows.map((f) => f.id)) + 1;
      set({ pick: null, pendingFrom: null, ...commit([...flows, { id, from: pendingFrom, to: at, vph: DEFAULT_VPH, label: `Поток ${id}` }]) });
    },
    update: (id, patch) => set(({ flows }) => commit(flows.map((f) => (f.id === id ? { ...f, ...patch, vph: patch.vph === undefined ? f.vph : clampVph(patch.vph) } : f)))),
    remove: (id) => set(({ flows }) => commit(flows.filter((f) => f.id !== id))),
    clear: () => set(commit([])),
  };
});

/** The flows as the simulator's OD demand: two zones per flow, its vehicles from the first to the second. */
export function flowsDemand(flows: readonly CustomFlow[]): { zones: Array<[number, number]>; od: number[][] } {
  const zones = flows.flatMap((f) => [[f.from.lon, f.from.lat], [f.to.lon, f.to.lat]] as Array<[number, number]>);
  const od = zones.map(() => zones.map(() => 0));
  flows.forEach((f, i) => { od[2 * i][2 * i + 1] = f.vph; });
  return { zones, od };
}
