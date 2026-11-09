import { describe, expect, it } from 'vitest';
import type { OsmDoc } from '../osm/types';
import type { SimResult } from '../sim/types';
import { buildReport, docStats } from './report';

const doc = {
  nodes: { a: { id: 'a', lon: 104.26, lat: 52.26, tags: {} }, b: { id: 'b', lon: 104.27, lat: 52.26, tags: {} } },
  ways: { w: { id: 'w', refs: ['a', 'b'], tags: { highway: 'secondary', name: 'Ленина & <Марата>' } }, x: { id: 'x', refs: ['a', 'b'], tags: { building: 'yes' } } },
} as unknown as OsmDoc;

const sim = (delay: number) => ({
  trips: 100, vehicles: 90, finished: 80, mean_time_loss_s: delay, mean_speed_kmh: 25, mean_waiting_s: 12,
  frames: [{ t: 0, v: [] }, { t: 60, v: [] }], timeline: { step_s: 60, ways: [{ way: 'w', delay: [0, 30, 70] }] },
}) as unknown as SimResult;

describe('jury report', () => {
  it('counts only road ways and their length', () => {
    const s = docStats(doc);
    expect(s.ways).toBe(1);
    expect(s.nodes).toBe(2);
    expect(s.km).toBeCloseTo(0.68, 1);
  });

  it('is a standalone page with micro KPIs, baseline delta and escaped names', () => {
    const html = buildReport({ fileName: 'test.osm', date: new Date(0), doc, macro: null, sim: sim(40), baseline: sim(60), scenarios: [], mapImage: null, wayName: (id) => doc.ways[id].tags.name });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toMatch(/<script|<link /);
    expect(html).toContain('−20,0');
    expect(html).toContain('Ленина &amp; &lt;Марата&gt;');
    expect(html).toContain('class="heat"');
    expect(html).toContain('@media print');
  });
});
