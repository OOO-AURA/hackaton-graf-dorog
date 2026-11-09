import type { OsmDoc } from '../osm/types';
import { levelOfService } from './store';
import type { Signal, SimResult, WayStat } from './types';

/** LOS colours reuse the speed and load bands so all three scales read the same way. */
export const LOS_COLORS: Readonly<Record<string, string>> = { A: '#3D9F47', B: '#3D9F47', C: '#F0BC2A', D: '#F09131', E: '#E5392A', F: '#E5392A' };
export const SIGNAL_COLORS = { green: '#3D9F47', yellow: '#F0BC2A', red: '#E5392A', off: '#8A8178' } as const;

export const statsByWay = (r: SimResult | null): Map<string, WayStat> => new Map((r?.ways ?? []).map((w) => [w.way, w]));

/** Road lines coloured by level of service of each way. */
export function losFeatures(doc: OsmDoc, r: SimResult): unknown[] {
  return r.ways.flatMap((s) => {
    const way = doc.ways[s.way];
    if (!way) return [];
    const coords = way.refs.map((id) => doc.nodes[id]).filter(Boolean).map((n) => [n.lon, n.lat]);
    if (coords.length < 2) return [];
    const los = levelOfService(s.delay_s);
    return [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: { kind: 'flow', v: s.entered * (3600 / Math.max(60, simSpan(r))), color: LOS_COLORS[los], way: s.way, los } }];
  });
}

const simSpan = (r: SimResult) => (r.frames.length ? r.frames[r.frames.length - 1].t : 0);

/** State of one light at time t. */
export function stateAt(sig: Signal, t: number): string {
  let state = sig.states[0]?.[1] ?? '';
  for (const [at, s] of sig.states) { if (at > t) break; state = s; }
  return state;
}

const colorOf = (c: string | undefined) => {
  if (!c) return SIGNAL_COLORS.off;
  if (c === 'G' || c === 'g') return SIGNAL_COLORS.green;
  if (c === 'y' || c === 'Y' || c === 'u') return SIGNAL_COLORS.yellow;
  if (c === 'o' || c === 'O') return SIGNAL_COLORS.off;
  return SIGNAL_COLORS.red;
};

/** One point per signal head, coloured by the phase at time t. */
export function signalFeatures(r: SimResult, t: number): unknown[] {
  return r.signals.flatMap((sig) => {
    const state = stateAt(sig, t);
    return sig.heads.map(([i, lon, lat]) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { kind: 'sig', color: colorOf(state[i]) } }));
  });
}
