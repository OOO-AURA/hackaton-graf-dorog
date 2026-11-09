import type { OsmDoc } from '../osm/types';
import { computeFlows, computeIsochrone, type FlowsOptions } from './compute';

export type FlowsJob =
  | { id: number; kind: 'flows'; doc: OsmDoc; opts: FlowsOptions }
  | { id: number; kind: 'iso'; doc: OsmDoc; nodeId: string };

self.onmessage = (e: MessageEvent<FlowsJob>) => {
  const job = e.data;
  try {
    const result = job.kind === 'flows' ? computeFlows(job.doc, job.opts) : computeIsochrone(job.doc, job.nodeId);
    self.postMessage({ id: job.id, result });
  } catch (err) {
    self.postMessage({ id: job.id, error: String(err) });
  }
};
