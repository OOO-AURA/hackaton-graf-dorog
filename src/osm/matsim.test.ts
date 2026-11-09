import { describe, expect, it } from 'vitest';
import { toMatsimNetwork } from './matsim';
import type { OsmDoc } from './types';

describe('MATSim export', () => {
  it('writes one link per direction with capacity and lanes', () => {
    const doc = {
      nodes: { a: { id: 'a', lon: 104.26, lat: 52.26, tags: {} }, b: { id: 'b', lon: 104.261, lat: 52.26, tags: {} } },
      ways: { w: { id: 'w', refs: ['a', 'b'], tags: { highway: 'secondary', lanes: '4' } } },
    } as unknown as OsmDoc;
    const xml = toMatsimNetwork(doc);
    expect(xml.match(/<node /g)).toHaveLength(2);
    expect(xml.match(/<link /g)).toHaveLength(2);
    expect(xml).toContain('permlanes="2"');
    expect(xml).toContain('EPSG:3857');
  });
});
