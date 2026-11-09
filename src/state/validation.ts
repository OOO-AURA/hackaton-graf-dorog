import type { OsmDoc } from '../osm/types';
import { validate, type ValidationReport } from '../osm/validate';
import { useEditor } from './store';

let worker: Worker | null = null;
type Job = { doc: OsmDoc; waiting: Array<(r: ValidationReport) => void> };
let running: Job | null = null;
/** At most one job waits behind the running one; newer graphs replace it, so stale checks are skipped. */
let queued: Job | null = null;

function finish(report: ValidationReport): void {
  running?.waiting.forEach((resolve) => resolve(report));
  running = queued;
  queued = null;
  if (running) worker!.postMessage({ doc: running.doc });
}

function fallback(): void {
  // A broken worker must not leave the check hanging: finish the jobs here.
  worker?.terminate();
  worker = null;
  for (const job of [running, queued]) job?.waiting.forEach((resolve) => resolve(validate(job.doc)));
  running = null;
  queued = null;
}

/**
 * Checks the graph off the main thread; on a big city fragment the check alone takes about half a
 * second. Callers waiting on a graph that was replaced by a newer one get the newer graph's report.
 */
export function validateInBackground(doc: OsmDoc): Promise<ValidationReport> {
  if (typeof Worker === 'undefined') return Promise.resolve(validate(doc));
  if (!worker) {
    try {
      worker = new Worker(new URL('../osm/validate.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      return Promise.resolve(validate(doc));
    }
    worker.onmessage = (e: MessageEvent<{ report?: ValidationReport; error?: string }>) => finish(e.data.report ?? validate(running!.doc));
    worker.onerror = fallback;
    worker.onmessageerror = fallback;
  }
  return new Promise((resolve) => {
    if (!running) {
      running = { doc, waiting: [resolve] };
      worker!.postMessage({ doc });
    } else {
      queued = { doc, waiting: [...(queued?.waiting ?? []), resolve] };
    }
  });
}

/** Re-checks the current graph and stores the report, unless the graph changed while the check ran. */
export async function refreshReport(): Promise<ValidationReport> {
  const doc = useEditor.getState().doc;
  const report = await validateInBackground(doc);
  if (useEditor.getState().doc === doc) useEditor.setState({ report });
  return report;
}
