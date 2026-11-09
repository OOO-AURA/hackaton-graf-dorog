import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseOsm } from '../osm/parse';
import { parseInterval, setRouteInterval, transitDemand, transitRoutes } from './routes';

describe('transit routes', () => {
  it('reads intervals in minutes and as durations', () => {
    expect(parseInterval('12')).toBe(12);
    expect(parseInterval('00:15')).toBe(15);
    expect(parseInterval('00:07:30')).toBe(7.5);
    expect(parseInterval('soon')).toBeNull();
  });

  it('finds bus routes with stops in the example and edits the interval', () => {
    const doc = parseOsm(readFileSync('public/example.osm', 'utf8'));
    const routes = transitRoutes(doc);
    expect(routes.length).toBeGreaterThan(10);
    const withStops = transitDemand(routes);
    expect(withStops.length).toBeGreaterThan(5);
    const r = routes[0];
    const edited = transitRoutes(setRouteInterval(doc, r.id, 6)).find((x) => x.id === r.id);
    expect(edited?.interval).toBe(6);
  });
});
