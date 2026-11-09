import type { OsmDoc } from './types';
import { validate } from './validate';

self.onmessage = (e: MessageEvent<{ doc: OsmDoc }>) => {
  const { doc } = e.data;
  try {
    self.postMessage({ report: validate(doc) });
  } catch (err) {
    self.postMessage({ error: String(err) });
  }
};
