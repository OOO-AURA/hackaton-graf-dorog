import type { CheckReport } from './check';

export interface MetricRow { readonly key: string; readonly before: string | null; readonly after: string; readonly delta: number | null }

const numberOf = (v: string | null) => {
  if (v === null) return null;
  const m = v.replace(/\s/g, '').replace(',', '.').match(/^-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};

/** Metrics of one stage of the current run next to the same metrics of the opened file. */
export function compareStage(current: CheckReport, baseline: CheckReport | null, stage: string): MetricRow[] {
  const cur = current.stages.find((s) => s.name === stage);
  const base = baseline?.stages.find((s) => s.name === stage);
  if (!cur) return [];
  const before = new Map(base?.metrics ?? []);
  return cur.metrics.map(([key, after]) => {
    const was = before.get(key) ?? null;
    const a = numberOf(after);
    const b = numberOf(was);
    return { key, before: was, after, delta: a !== null && b !== null ? Math.round((a - b) * 100) / 100 : null };
  });
}
