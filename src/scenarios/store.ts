import { create } from 'zustand';
import type { OsmDoc } from '../osm/types';
import { useEditor } from '../state/store';
import { useMacro } from '../macro/store';
import { useSim } from '../sim/store';
import type { MacroResult } from '../macro/compute';
import type { SimResult } from '../sim/types';

export interface MacroKpi { vkt: number; vht: number; overloaded: number; gap: number }
export interface MicroKpi { trips: number; finished: number; delay: number; speed: number; waiting: number }

export interface Scenario {
  id: number;
  name: string;
  doc: OsmDoc;
  macro: MacroKpi | null;
  micro: MicroKpi | null;
  /** Graph versions the numbers were computed on; differ from `doc` once the graph is edited again. */
  macroDoc: OsmDoc | null;
  microDoc: OsmDoc | null;
}

export const macroKpi = (r: MacroResult): MacroKpi => ({ vkt: r.vkt, vht: r.vht, overloaded: r.overloaded, gap: r.gap });
export const microKpi = (r: SimResult): MicroKpi => ({
  trips: r.trips, finished: r.finished, delay: r.mean_time_loss_s, speed: r.mean_speed_kmh, waiting: r.mean_waiting_s,
});

interface ScenarioState {
  list: Scenario[];
  active: number | null;
  /** Saves the current graph and its latest results as a new scenario and makes it active. */
  save: (name: string) => void;
  /** Keeps the edits of the active scenario, then loads another one into the editor. */
  switchTo: (id: number) => void;
  rename: (id: number, name: string) => void;
  remove: (id: number) => void;
  /** Records results computed on the current graph against the active scenario. */
  record: (kind: 'macro' | 'micro', kpi: MacroKpi | MicroKpi) => void;
  reset: () => void;
}

let nextId = 1;

/** Short default name: «База» first, then «Вариант А», «Вариант Б», … */
export function defaultName(count: number): string {
  if (count === 0) return 'База';
  return `Вариант ${'АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЭЮЯ'[(count - 1) % 27]}`;
}

export const useScenarios = create<ScenarioState>((set, get) => ({
  list: [],
  active: null,
  save: (name) => {
    const doc = useEditor.getState().doc;
    const macro = useMacro.getState().result;
    const sim = useSim.getState().result;
    const s: Scenario = {
      id: nextId++, name: name.trim() || defaultName(get().list.length), doc,
      macro: macro ? macroKpi(macro) : null, micro: sim ? microKpi(sim) : null,
      macroDoc: macro ? doc : null, microDoc: sim ? doc : null,
    };
    // The previous scenario keeps its graph: the edits since then become the new variant.
    set(({ list }) => ({ list: [...list, s], active: s.id }));
  },
  switchTo: (id) => {
    const target = get().list.find((s) => s.id === id);
    if (!target || id === get().active) return;
    set(({ list, active }) => ({ list: syncActive(list, active), active: id }));
    useEditor.setState({ doc: target.doc, past: [], future: [], selection: null, drawing: [], report: null });
    // Results on screen belong to the previous graph.
    useMacro.getState().clear();
    useSim.setState({ result: null, playing: false, time: 0 });
  },
  rename: (id, name) => set(({ list }) => ({ list: list.map((s) => (s.id === id ? { ...s, name: name.trim() || s.name } : s)) })),
  remove: (id) => set(({ list, active }) => ({ list: list.filter((s) => s.id !== id), active: active === id ? null : active })),
  record: (kind, kpi) => {
    const { active } = get();
    if (active === null) return;
    const doc = useEditor.getState().doc;
    set(({ list }) => ({
      list: list.map((s) => (s.id !== active ? s : kind === 'macro'
        ? { ...s, doc, macro: kpi as MacroKpi, macroDoc: doc }
        : { ...s, doc, micro: kpi as MicroKpi, microDoc: doc })),
    }));
  },
  reset: () => set({ list: [], active: null }),
}));

/** The active scenario follows the editor: its graph is whatever is on screen now. */
function syncActive(list: Scenario[], active: number | null): Scenario[] {
  if (active === null) return list;
  const doc = useEditor.getState().doc;
  return list.map((s) => (s.id === active ? { ...s, doc } : s));
}

// New results go to the active scenario as soon as they appear.
useMacro.subscribe((s, prev) => { if (s.result && s.result !== prev.result) useScenarios.getState().record('macro', macroKpi(s.result)); });
useSim.subscribe((s, prev) => { if (s.result && s.result !== prev.result) useScenarios.getState().record('micro', microKpi(s.result)); });
// A new file starts a new set of scenarios.
// Opening a file replaces both doc and savedDoc; saving only moves savedDoc.
useEditor.subscribe((s, prev) => { if (s.savedDoc !== prev.savedDoc && s.doc !== prev.doc) useScenarios.getState().reset(); });
