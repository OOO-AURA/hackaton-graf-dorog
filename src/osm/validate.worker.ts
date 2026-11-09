import type { OsmDoc } from './types';
import { validate } from './validate';

self.onmessage = (e: MessageEvent<{ id: number; doc: OsmDoc }>) => {
  const { id, doc } = e.data;
  try {
    self.postMessage({ id, report: validate(doc) });
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
