import { create } from 'zustand';
import { serializeOsm } from '../osm/serialize';
import { isDesktop } from '../platform';
import { useEditor } from '../state/store';
import { STRIDE, type SimResult } from './types';

export const SPEEDS = [1, 5, 10, 30, 60] as const;

interface SimState {
  running: boolean;
  error: string | null;
  result: SimResult | null;
  minutes: number;
  playing: boolean;
  speed: number;
  /** Model time in seconds. */
  time: number;
  setMinutes: (m: number) => void;
  setSpeed: (s: number) => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  step: () => void;
  seek: (t: number) => void;
}

export const useSim = create<SimState>((set, get) => ({
  running: false, error: null, result: null, minutes: 10, playing: false, speed: 10, time: 0,
  setMinutes: (minutes) => set({ minutes }),
  setSpeed: (speed) => set({ speed }),
  play: () => { if (get().result) set({ playing: true }); },
  pause: () => set({ playing: false }),
  stop: () => set({ playing: false, time: 0 }),
  step: () => set(({ time }) => ({ playing: false, time: time + 2 })),
  seek: (time) => set({ time }),
}));

export const simEnd = (r: SimResult | null) => (r?.frames.length ? r.frames[r.frames.length - 1].t : 0);

/** Runs SUMO on the current graph in the desktop app. */
export async function runSimulation(): Promise<void> {
  const { minutes } = useSim.getState();
  if (!isDesktop) { useSim.setState({ error: 'Симуляция работает в настольном приложении: в браузере нет доступа к SUMO.' }); return; }
  useSim.setState({ running: true, error: null, playing: false, time: 0 });
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke<SimResult>('simulate', { text: serializeOsm(useEditor.getState().doc), minutes });
    useSim.setState({ result, playing: true });
  } catch (err) {
    useSim.setState({ error: String(err) });
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
      properties: { angle: a.v[j + 3], color: bandColor(kmh), type: r.types[a.v[j + 5]] ?? 'car', big: a.v[j + 5] >= 2 },
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
