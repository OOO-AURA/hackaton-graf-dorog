import { transitDemand, transitRoutes } from '../transit/routes';
import { useTransit } from '../transit/store';
import { create } from 'zustand';
import { serializeOsm } from '../osm/serialize';
import { isDesktop } from '../platform';
import { useEditor } from '../state/store';
import { useMacro } from '../macro/store';
import { STRIDE, type DemandKind, type SimResult } from './types';

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
}

export const ADAPTIVE_DEFAULTS = { minGreen: 8, maxGreen: 50, maxGap: 3 } as const;

/** The plan as the desktop simulator takes it. */
export const planForSim = (p: SignalPlan) => ({
  cycle_s: p.cycle, main_share: p.mainShare, adaptive: p.mode === 'adaptive',
  min_green_s: p.minGreen ?? ADAPTIVE_DEFAULTS.minGreen, max_green_s: p.maxGreen ?? ADAPTIVE_DEFAULTS.maxGreen, max_gap_s: p.maxGap ?? ADAPTIVE_DEFAULTS.maxGap,
});

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

export const useSim = create<SimState>((set, get) => ({
  sumo: null, running: false, error: null, result: null, minutes: 10, pedestrians: false, plans: {}, demand: 'random', baseline: null, playing: false, speed: 10, time: 0,
  setMinutes: (minutes) => set({ minutes }),
  setPedestrians: (pedestrians) => set({ pedestrians }),
  setPlan: (node, plan) => set(({ plans }) => {
    const next = { ...plans };
    if (plan) next[node] = plan; else delete next[node];
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
    const doc = useEditor.getState().doc;
    const extras = { transit: useTransit.getState().inSim ? transitDemand(transitRoutes(doc)) : [], pedestrians: useSim.getState().pedestrians,
      signals: Object.entries(useSim.getState().plans).filter(([id]) => doc.nodes[id]?.tags.highway === 'traffic_signals')
        .map(([id, p]) => ({ node: id, lon: doc.nodes[id].lon, lat: doc.nodes[id].lat, ...planForSim(p) })) };
    const result = await invoke<SimResult>('simulate', { text: serializeOsm(doc), minutes, demand: od, extras });
    useSim.setState({ result, playing: true });
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
/** Which top-view sprite (public/models/*.png) and real length in metres a vehicle type gets. */
export function vehicleLook(type: string, id: number): { sprite: string; len: number } {
  switch (type) {
    case 'ped': return { sprite: 'veh-person', len: 0.9 };
    case 'truck': return { sprite: 'veh-truck', len: 9 };
    case 'trailer': return { sprite: 'veh-truck', len: 16.5 };
    case 'bus': case 'ptbus': return { sprite: 'veh-bus', len: 12 };
    case 'bus18': return { sprite: 'veh-trolley', len: 18 };
    case 'tram': return { sprite: 'veh-tram', len: 27 };
    case 'bike': return { sprite: 'veh-bike', len: 1.8 };
    case 'scooter': return { sprite: 'veh-scooter', len: 1.1 };
    case 'van': return { sprite: 'veh-car2', len: 5.5 };
    default: return { sprite: id % 2 ? 'veh-car2' : 'veh-car1', len: 4.5 };
  }
}

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
        const look = vehicleLook(type, id);
        return type === 'ped'
          ? { angle: a.v[j + 3], color: '#3F8BC4', type, big: false, ...look }
          : { angle: a.v[j + 3], color: bandColor(kmh), type, big: a.v[j + 5] >= 2, ...look };
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
