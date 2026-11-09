import type { OsmDoc } from '../osm/types';
import { validate, type ValidationReport } from '../osm/validate';
import { useEditor } from './store';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { doc: OsmDoc; resolve: (r: ValidationReport) => void }>();

function failAll(): void {
  // A broken worker must not leave the check hanging: finish the queued jobs here.
  pending.forEach(({ doc, resolve }) => resolve(validate(doc)));
  pending.clear();
  worker?.terminate();
  worker = null;
}

/** Checks the graph off the main thread; on a big city fragment the check alone takes about half a second. */
export function validateInBackground(doc: OsmDoc): Promise<ValidationReport> {
  if (typeof Worker === 'undefined') return Promise.resolve(validate(doc));
  if (!worker) {
    try {
      worker = new Worker(new URL('../osm/validate.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      return Promise.resolve(validate(doc));
    }
    worker.onmessage = (e: MessageEvent<{ id: number; report?: ValidationReport; error?: string }>) => {
      const job = pending.get(e.data.id);
      pending.delete(e.data.id);
      if (job) job.resolve(e.data.report ?? validate(job.doc));
    };
    worker.onerror = failAll;
  }
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, { doc, resolve });
    worker!.postMessage({ id, doc });
  });
}

/** Re-checks the current graph and stores the report, unless the graph changed while the check ran. */
export async function refreshReport(): Promise<ValidationReport> {
  const doc = useEditor.getState().doc;
  const report = await validateInBackground(doc);
  if (useEditor.getState().doc === doc) useEditor.setState({ report });
  return report;
}
