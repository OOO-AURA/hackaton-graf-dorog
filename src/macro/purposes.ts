import { dijkstra, type Network, type Zone } from './model';

export { homeShare } from './model';

/** Trip purposes of the peak hour: share of all trips and a default distance decay, 1/min. */
export const PURPOSES = [
  { id: 'hbw', label: 'Дом–работа', share: 0.45, betaFactor: 0.5 },
  { id: 'hbo', label: 'Дом–прочее', share: 0.55, betaFactor: 1 },
] as const;
/** β of «дом–прочее»; work trips are less sensitive to time, so their β is half of it. */
export const DEFAULT_BETA = 0.1;

/** Both purposes for a base β: matrices and the mix. */
export function purposeMatrices(times: number[][], zones: ReadonlyArray<{ home?: number; work?: number; weight: number }>, total: number, beta: number) {
  const home = zones.map((z) => z.home ?? z.weight);
  const work = zones.map((z) => z.work ?? z.weight);
  const all = zones.map((z) => z.weight);
  const mats = PURPOSES.map((p) => purposeOd(times, home, p.id === 'hbw' ? work : all, total * p.share, beta * p.betaFactor));
  return { mats, od: combine(mats) };
}
export type PurposeId = (typeof PURPOSES)[number]['id'];


/** Free-flow (or any cost) travel time between zone nodes, minutes. */
export function skim(net: Network, zones: readonly Zone[], cost: ArrayLike<number> = net.links.map((l) => l.t0)): number[][] {
  return zones.map((z) => {
    const { dist } = dijkstra(net, z.node, cost);
    return zones.map((b) => dist[b.node] / 60);
  });
}

/**
 * Singly constrained gravity model of one purpose: productions at homes, attractions at
 * `attract`, deterrence exp(-β t). Returns trips per hour summing to `total`.
 */
export function purposeOd(times: number[][], prod: readonly number[], attract: readonly number[], total: number, beta: number): number[][] {
  const n = times.length;
  const raw = times.map((row, i) => row.map((t, j) => (i === j || !Number.isFinite(t) ? 0 : attract[j] * Math.exp(-beta * t))));
  const prodSum = prod.reduce((s, v) => s + v, 0) || 1;
  return raw.map((row, i) => {
    const s = row.reduce((a, v) => a + v, 0);
    const out = (prod[i] / prodSum) * total;
    return s > 0 ? row.map((v) => (v / s) * out) : Array(n).fill(0);
  });
}

/** Mean trip time of a matrix, minutes. */
export function meanTime(od: number[][], times: number[][]): number {
  let n = 0;
  let t = 0;
  od.forEach((row, i) => row.forEach((v, j) => { if (v > 0 && Number.isFinite(times[i][j])) { n += v; t += v * times[i][j]; } }));
  return n ? t / n : 0;
}

/**
 * β that makes `meanAt(β)` hit the target mean trip time, by bisection on a log scale; null when out of reach.
 * `ends` are meanAt at the two ends of the range when the caller already has them.
 */
export function solveBeta(meanAt: (beta: number) => number, target: number, steps = 40, ends?: readonly [number, number]): number | null {
  let lo = 0.001;
  let hi = 2;
  const [atHi, atLo] = ends ?? [meanAt(hi), meanAt(lo)];
  if (target > atLo || target < atHi) return null;
  for (let k = 0; k < steps; k++) {
    const mid = Math.sqrt(lo * hi);
    if (meanAt(mid) > target) lo = mid; else hi = mid;
  }
  return Math.sqrt(lo * hi);
}

/** Trip time distribution in 2-minute bins: share of trips per bin. */
export function timeHistogram(od: number[][], times: number[][], bin = 2): Array<{ from: number; share: number }> {
  const counts: number[] = [];
  let total = 0;
  od.forEach((row, i) => row.forEach((v, j) => {
    const t = times[i][j];
    if (v <= 0 || !Number.isFinite(t)) return;
    const k = Math.floor(t / bin);
    counts[k] = (counts[k] ?? 0) + v;
    total += v;
  }));
  return Array.from({ length: counts.length }, (_, k) => ({ from: k * bin, share: total ? (counts[k] ?? 0) / total : 0 }));
}

export const roundOd = (od: number[][]) => od.map((row) => row.map((v) => Math.round(v)));

/** Sum of purpose matrices, symmetrised so return trips are in the same hour. */
export function combine(mats: number[][][]): number[][] {
  const n = mats[0]?.length ?? 0;
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => mats.reduce((s, m) => s + (m[i][j] + m[j][i]) / 2, 0)));
}
