import { describe, expect, it } from 'vitest';
import type { OsmDoc } from '../osm/types';
import { assign, bpr, buildNetwork, dijkstra, gravityOd, gridZones } from './model';

const node = (id: string, lon: number, lat: number) => ({ id, lon, lat, tags: {}, attrs: {} });
const way = (id: string, refs: string[], tags: Record<string, string>) => ({ id, refs, tags, attrs: {} });

// Two parallel routes from a to d: a fast one with one lane and a slow one with two.
const doc: OsmDoc = {
  rootAttrs: {}, bounds: null, relations: {}, deleted: {}, nextId: 100,
  nodes: { a: node('a', 0, 0), b: node('b', 0.01, 0.001), c: node('c', 0.01, -0.003), d: node('d', 0.02, 0) },
  ways: {
    fast: way('fast', ['a', 'b', 'd'], { highway: 'primary', lanes: '1', oneway: 'yes', maxspeed: '60' }),
    slow: way('slow', ['a', 'c', 'd'], { highway: 'primary', lanes: '2', oneway: 'yes', maxspeed: '40' }),
  },
};

describe('macro model', () => {
  const net = buildNetwork(doc);
  it('builds one link per segment and direction', () => {
    expect(net.links).toHaveLength(4);
  });
  it('finds the fastest route', () => {
    const { dist } = dijkstra(net, net.nodeIds.indexOf('a'), net.links.map((l) => l.t0));
    expect(dist[net.nodeIds.indexOf('d')]).toBeCloseTo(net.links.filter((l) => l.wayId === 'fast').reduce((s, l) => s + l.t0, 0), 3);
  });
  it('spreads a heavy demand over both routes', () => {
    const zones = [{ id: 1, name: 'A', node: net.nodeIds.indexOf('a'), lonlat: [0, 0] as [number, number], weight: 1 }, { id: 2, name: 'B', node: net.nodeIds.indexOf('d'), lonlat: [0.02, 0] as [number, number], weight: 1 }];
    const r = assign(net, zones, [[0, 3000], [0, 0]], 50);
    const onWay = (w: string) => net.links.findIndex((l) => l.wayId === w);
    expect(r.volume[onWay('fast')] + r.volume[onWay('slow')]).toBeCloseTo(3000, 0);
    expect(r.volume[onWay('slow')]).toBeGreaterThan(500);
    expect(r.unrouted).toBe(0);
  });
  it('makes zones and a gravity matrix', () => {
    const zones = gridZones(net, 2);
    expect(zones.length).toBeGreaterThan(1);
    const od = gravityOd(net, zones, 1000);
    expect(od.every((row, i) => row[i] === 0)).toBe(true);
  });
  it('bpr grows with load', () => {
    expect(bpr(10, 1000, 1000)).toBeCloseTo(11.5);
  });
});
