import { transitDemand, transitRoutes } from '../transit/routes';
import { useTransit } from '../transit/store';
import { create } from 'zustand';
import { serializeOsm } from '../osm/serialize';
import { isDesktop } from '../platform';
import { useEditor } from '../state/store';
import { useMacro } from '../macro/store';
import { STRIDE, type DemandKind, type SimResult, type SimTuning } from './types';
import { flowsDemand, useCustomFlows } from './customFlows';
import type { SignalPhase } from '../osm/signalPhases';

export const SPEEDS = [1, 5, 10, 30, 60] as const;

/**
 * Program of one traffic light in the micro run. `fixed`: a cycle of `cycle` s with `mainShare`
 * of the green for the main direction. `adaptive` (SUMO actuated): green lasts at least `minGreen`
 * and at most `maxGreen` s and goes on while cars keep coming, ending once the gap between them is
 * over `maxGap` s, so a busy direction gets more green and an empty one gives it away.
 */
export interface SignalPlan {
  mode?: 'fixed' | 'adaptive';
  cycle: number;
  mainShare: number;
  minGreen?: number;
  maxGreen?: number;
  maxGap?: number;
  /** Extra sections: a separate left-turn phase (green arrow to the left) before the main one. */
  leftArrow?: boolean;
  /** A green arrow to the right: right turns go in every green phase. */
  rightArrow?: boolean;
  /** A phase when all cars stand and only pedestrians cross, `pedSeconds` long. */
  pedPhase?: boolean;
  pedSeconds?: number;
  /**
   * The engineer's own phases (signalPhases.ts): when set they replace the cycle share and the
   * extra sections, and go to SUMO as a tlLogic of exactly these phases.
   */
  phases?: SignalPhase[];
  /** Start of the cycle against the common clock, for a green wave, seconds. */
  offset?: number;
  /** Saturation flow of a lane, vehicles an hour of green; lost time of a phase, s; walking speed, m/s. */
  satFlow?: number;
  lostTime?: number;
  pedSpeed?: number;
}

export const ADAPTIVE_DEFAULTS = { minGreen: 8, maxGreen: 50, maxGap: 3 } as const;

/** The plan as the desktop simulator takes it. */
export const planForSim = (p: SignalPlan) => ({
  cycle_s: p.cycle, main_share: p.mainShare, adaptive: p.mode === 'adaptive',
  min_green_s: p.minGreen ?? ADAPTIVE_DEFAULTS.minGreen, max_green_s: p.maxGreen ?? ADAPTIVE_DEFAULTS.maxGreen, max_gap_s: p.maxGap ?? ADAPTIVE_DEFAULTS.maxGap,
  left_arrow: Boolean(p.leftArrow), right_arrow: Boolean(p.rightArrow), ped_phase: Boolean(p.pedPhase), ped_s: p.pedSeconds ?? PED_SECONDS,
  offset_s: p.offset ?? 0,
  phases: (p.phases ?? []).map((ph) => ({ green_s: ph.green, yellow_s: ph.yellow, all_red_s: ph.allRed, ped: Boolean(ph.ped), moves: ph.moves })),
});

export const PED_SECONDS = 15;

/** What the desktop app found of the SUMO install (see sumo_status in sim.rs). */
export interface SumoStatus { ok: boolean; version: string | null; bin: string; sumo_home: string | null; missing: string[] }

interface SimState {
  /** null until checked; the browser build never checks. */
  sumo: SumoStatus | null;
  running: boolean;
  error: string | null;
  result: SimResult | null;
  minutes: number;
  pedestrians: boolean;
  /** Signal timing per OSM node, set in the node inspector. */
  plans: Record<string, SignalPlan>;
  setPlan: (node: string, plan: SignalPlan | null) => void;
  setPedestrians: (on: boolean) => void;
  demand: DemandKind;
  /** Run kept for comparison after the graph is edited. */
  baseline: SimResult | null;
  playing: boolean;
  speed: number;
  /** Model time in seconds. */
  time: number;
  /** Fine settings of the model, kept between runs and sessions. */
  tuning: SimTuning;
  setTuning: (patch: Partial<SimTuning>) => void;
  resetTuning: () => void;
  setMinutes: (m: number) => void;
  setDemand: (d: DemandKind) => void;
  keepBaseline: () => void;
  dropBaseline: () => void;
  setSpeed: (s: number) => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  step: () => void;
  seek: (t: number) => void;
}

/**
 * Light programs have no standard OSM tags, so they are kept beside the file: per file name in
 * the browser storage, and come back when the file is opened again.
 */
const PLANS_KEY = 'graf.signal-plans:';
function savePlans(fileName: string, plans: Record<string, SignalPlan>): void {
  try { localStorage.setItem(PLANS_KEY + fileName, JSON.stringify(plans)); } catch { /* storage off: the plans hold for this session */ }
}
function loadPlans(fileName: string): Record<string, SignalPlan> {
  try { return JSON.parse(localStorage.getItem(PLANS_KEY + fileName) ?? '{}') as Record<string, SignalPlan>; } catch { return {}; }
}

const TUNING_KEY = 'graf.sim-tuning';
function loadTuning(): SimTuning {
  try { return JSON.parse(localStorage.getItem(TUNING_KEY) ?? '{}') as SimTuning; } catch { return {}; }
}
function saveTuning(t: SimTuning): void {
  try { localStorage.setItem(TUNING_KEY, JSON.stringify(t)); } catch { /* storage off: holds for this session */ }
}

export const useSim = create<SimState>((set, get) => ({
  tuning: loadTuning(),
  setTuning: (patch) => set(({ tuning }) => {
    const next: SimTuning = { ...tuning, ...patch };
    for (const k of Object.keys(next) as (keyof SimTuning)[]) if (next[k] === undefined) delete next[k];
    saveTuning(next);
    return { tuning: next };
  }),
  resetTuning: () => { saveTuning({}); set({ tuning: {} }); },
  sumo: null, running: false, error: null, result: null, minutes: 10, pedestrians: false, plans: {}, demand: 'random', baseline: null, playing: false, speed: 10, time: 0,
  setMinutes: (minutes) => set({ minutes }),
  setPedestrians: (pedestrians) => set({ pedestrians }),
  setPlan: (node, plan) => set(({ plans }) => {
    const next = { ...plans };
    if (plan) next[node] = plan; else delete next[node];
    savePlans(useEditor.getState().fileName, next);
    return { plans: next };
  }),
  setDemand: (demand) => set(demand === 'od' ? { demand, minutes: Math.max(get().minutes, 15) } : { demand }),
  keepBaseline: () => set(({ result }) => ({ baseline: result })),
  dropBaseline: () => set({ baseline: null }),
  setSpeed: (speed) => set({ speed }),
  play: () => { if (get().result) set({ playing: true }); },
  pause: () => set({ playing: false }),
  stop: () => set({ playing: false, time: 0 }),
  step: () => set(({ time }) => ({ playing: false, time: time + 2 })),
  seek: (time) => set({ time }),
}));

export const simEnd = (r: SimResult | null) => (r?.frames.length ? r.frames[r.frames.length - 1].t : 0);

/** Runs SUMO on the current graph in the desktop app. */
/** Asks the desktop app whether sumo, netconvert and the SUMO tools are reachable. */
export async function checkSumo(): Promise<SumoStatus | null> {
  if (!isDesktop) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const sumo = await invoke<SumoStatus>('sumo_status');
    useSim.setState({ sumo });
    return sumo;
  } catch {
    return null;
  }
}

export async function runSimulation(): Promise<void> {
  const { minutes, demand } = useSim.getState();
  if (!isDesktop) { useSim.setState({ error: 'Симуляция работает в настольном приложении: в браузере нет доступа к SUMO.' }); return; }
  const sumo = useSim.getState().sumo ?? await checkSumo();
  if (sumo && !sumo.ok) { useSim.setState({ error: null }); return; }
  useSim.setState({ running: true, error: null, playing: false, time: 0 });
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    let od = null;
    if (demand === 'od') {
      // The macro model is recalculated on the current graph so both levels see the same edits.
      await useMacro.getState().run();
      const macro = useMacro.getState().result;
      if (!macro || useMacro.getState().error) throw new Error(useMacro.getState().error ?? 'Не удалось посчитать матрицу корреспонденций');
      od = { zones: macro.zones.map((z) => z.lonlat), od: macro.od };
    }
    if (demand === 'custom') {
      const flows = useCustomFlows.getState().flows;
      if (!flows.length) throw new Error('Своих потоков пока нет: добавьте их в панели «Микро», кликнув на карте откуда и куда едут');
      od = flowsDemand(flows);
    }
    const doc = useEditor.getState().doc;
    const extras = { tuning: useSim.getState().tuning, transit: useTransit.getState().inSim ? transitDemand(transitRoutes(doc)) : [], pedestrians: useSim.getState().pedestrians, rush_hour: demand === 'rush',
      signals: Object.entries(useSim.getState().plans).filter(([id]) => doc.nodes[id]?.tags.highway === 'traffic_signals')
        .map(([id, p]) => ({ node: id, lon: doc.nodes[id].lon, lat: doc.nodes[id].lat, ...planForSim(p) })) };
    const result = await invoke<SimResult>('simulate', { text: serializeOsm(doc), minutes, demand: od, extras });
    useSim.setState({ result: demand === 'custom' ? { ...result, demand: 'custom' } : result, playing: true });
  } catch (err) {
    useSim.setState({ error: err instanceof Error ? err.message : String(err) });
  } finally {
    useSim.setState({ running: false });
  }
}

/** Speed bands of the legend, km/h; colours come from the palette. */
export const SPEED_BANDS = [
  { min: 40, label: 'от 40 км/ч', color: '#3D9F47' },
  { min: 25, label: '25–40', color: '#F0BC2A' },
  { min: 10, label: '10–25', color: '#F09131' },
  { min: 0, label: 'до 10, затор', color: '#E5392A' },
] as const;

export const bandColor = (kmh: number) => SPEED_BANDS.find((b) => kmh >= b.min)?.color ?? SPEED_BANDS[3].color;

/** Vehicle positions at time t, interpolated between the two surrounding FCD frames. */
export function vehiclesAt(r: SimResult, t: number) {
  const frames = r.frames;
  if (!frames.length) return { type: 'FeatureCollection', features: [] };
  let i = frames.findIndex((f) => f.t > t);
  if (i === -1) i = frames.length;
  const a = frames[Math.max(0, i - 1)];
  const b = frames[Math.min(frames.length - 1, i)];
  const k = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
  const next = new Map<number, number>();
  for (let j = 0; j < b.v.length; j += STRIDE) next.set(b.v[j], j);
  const features = [];
  for (let j = 0; j < a.v.length; j += STRIDE) {
    const id = a.v[j];
    const nj = next.get(id);
    const lon = nj === undefined ? a.v[j + 1] : a.v[j + 1] + (b.v[nj + 1] - a.v[j + 1]) * k;
    const lat = nj === undefined ? a.v[j + 2] : a.v[j + 2] + (b.v[nj + 2] - a.v[j + 2]) * k;
    const kmh = a.v[j + 4] * 3.6;
    features.push({
      type: 'Feature',
      properties: (() => {
        const type = r.types[a.v[j + 5]] ?? 'car';
        // Walking speed would read as a jam on the speed scale, so people get their own colour.
        return type === 'ped'
          ? { angle: a.v[j + 3], color: '#3F8BC4', type, big: false }
          : { angle: a.v[j + 3], color: bandColor(kmh), type, big: a.v[j + 5] >= 2 };
      })(),
      geometry: { type: 'Point', coordinates: [lon, lat] },
    });
  }
  return { type: 'FeatureCollection', features };
}

/** Per-frame series for the charts: vehicles in the network and their mean speed, km/h. */
export function series(r: SimResult) {
  return r.frames.map((f) => {
    const n = f.v.length / STRIDE;
    let sum = 0;
    for (let j = 4; j < f.v.length; j += STRIDE) sum += f.v[j];
    return { t: f.t, n, kmh: n ? (sum / n) * 3.6 : 0 };
  });
}

/** HCM level of service from mean control delay per vehicle, seconds. */
export function levelOfService(delay: number): 'A' | 'B' | 'C' | 'D' | 'E' | 'F' {
  if (delay <= 10) return 'A';
  if (delay <= 20) return 'B';
  if (delay <= 35) return 'C';
  if (delay <= 55) return 'D';
  if (delay <= 80) return 'E';
  return 'F';
}

// A file opened (or opened again) brings its light programs back.
let shownFile: string | null = null;
useEditor.subscribe((s) => {
  if (s.fileName === shownFile) return;
  shownFile = s.fileName;
  useSim.setState({ plans: loadPlans(s.fileName) });
});
