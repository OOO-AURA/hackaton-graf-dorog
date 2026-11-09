import type { OsmDoc } from '../osm/types';
import { computeFlows, computeIsochrone } from './compute';

export type FlowsJob =
  | { id: number; kind: 'flows'; doc: OsmDoc; side: number; trips: number }
  | { id: number; kind: 'iso'; doc: OsmDoc; nodeId: string };

self.onmessage = (e: MessageEvent<FlowsJob>) => {
  const job = e.data;
  try {
    const result = job.kind === 'flows' ? computeFlows(job.doc, job.side, job.trips) : computeIsochrone(job.doc, job.nodeId);
    self.postMessage({ id: job.id, result });
  } catch (err) {
    self.postMessage({ id: job.id, error: String(err) });
  }
};
