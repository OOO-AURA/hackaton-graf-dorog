import { create } from 'zustand';

interface TransitState {
  /** Route highlighted on the map and opened in the panel. */
  selected: string | null;
  /** Whether the micro run adds the route buses. */
  inSim: boolean;
  select: (id: string | null) => void;
  setInSim: (on: boolean) => void;
}

export const useTransit = create<TransitState>((set) => ({
  selected: null,
  inSim: true,
  select: (selected) => set({ selected }),
  setInSim: (inSim) => set({ inSim }),
}));
