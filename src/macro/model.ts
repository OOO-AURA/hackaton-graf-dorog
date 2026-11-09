import { capacity } from '../osm/profile';
import { direction, isDrivable } from '../osm/tags';
import type { OsmDoc } from '../osm/types';

/** Directed link of the macro network. */
export interface Link {
  readonly from: number;
  readonly to: number;
  readonly wayId: string;
  readonly coords: ReadonlyArray<[number, number]>;
  /** Free-flow travel time, seconds. */
  readonly t0: number;
  /** Capacity of this direction, vehicles per hour. */
  readonly cap: number;
}

export interface Network {
  readonly nodeIds: readonly string[];
  readonly lonlat: ReadonlyArray<[number, number]>;
  readonly links: readonly Link[];
  readonly out: ReadonlyArray<readonly number[]>;
}

const R = 6371000;
export function metres(a: readonly [number, number], b: readonly [number, number]): number {
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLon = (b[0] - a[0]) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const speedKmh = (v: string | undefined, fallback: number) => { const n = parseFloat(v ?? ''); return Number.isFinite(n) && n > 0 ? n : fallback; };

/** Builds the directed graph of drivable roads; each way segment between two nodes is one link per allowed direction. */
export function buildNetwork(doc: OsmDoc): Network {
  const index = new Map<string, number>();
  const nodeIds: string[] = [];
  const lonlat: Array<[number, number]> = [];
  const at = (id: string) => {
    let i = index.get(id);
    if (i === undefined) { i = nodeIds.length; index.set(id, i); nodeIds.push(id); const n = doc.nodes[id]; lonlat.push([n.lon, n.lat]); }
    return i;
  };
  const links: Link[] = [];
  for (const way of Object.values(doc.ways)) {
    if (!isDrivable(way.tags)) continue;
    const refs = way.refs.filter((r) => doc.nodes[r]);
    if (refs.length < 2) continue;
    const dir = direction(way.tags);
    const v = speedKmh(way.tags.maxspeed, way.tags.highway === 'service' ? 20 : 50) / 3.6;
    const cap = Math.max(300, capacity(way.tags));
    for (let k = 0; k + 1 < refs.length; k++) {
      const a = at(refs[k]); const b = at(refs[k + 1]);
      const coords: Array<[number, number]> = [lonlat[a], lonlat[b]];
      const t0 = Math.max(0.5, metres(lonlat[a], lonlat[b]) / v);
      if (dir !== 'backward') links.push({ from: a, to: b, wayId: way.id, coords, t0, cap });
      if (dir !== 'forward') links.push({ from: b, to: a, wayId: way.id, coords: [coords[1], coords[0]], t0, cap });
    }
  }
  const out: number[][] = nodeIds.map(() => []);
  links.forEach((l, i) => out[l.from].push(i));
  return { nodeIds, lonlat, links, out };
}

/** Binary heap keyed by distance. */
class Heap {
  private items: Array<[number, number]> = [];
  get size() { return this.items.length; }
  push(d: number, v: number) {
    const a = this.items; a.push([d, v]);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop(): [number, number] {
    const a = this.items; const top = a[0]; const last = a.pop()!;
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1; const r = l + 1; let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

/** Shortest travel times from one node and the link used to reach each node. */
export function dijkstra(net: Network, source: number, cost: ArrayLike<number>): { dist: Float64Array; via: Int32Array } {
  const n = net.nodeIds.length;
  const dist = new Float64Array(n).fill(Infinity);
  const via = new Int32Array(n).fill(-1);
  dist[source] = 0;
  const heap = new Heap(); heap.push(0, source);
  while (heap.size) {
    const [d, u] = heap.pop();
    if (d > dist[u]) continue;
    for (const li of net.out[u]) {
      const l = net.links[li]; const nd = d + cost[li];
      if (nd < dist[l.to]) { dist[l.to] = nd; via[l.to] = li; heap.push(nd, l.to); }
    }
  }
  return { dist, via };
}

export interface Zone { readonly id: number; readonly name: string; readonly node: number; readonly lonlat: [number, number]; readonly weight: number }

/** Splits the network into a grid of zones; each zone is served by the node closest to its centre. */
export function gridZones(net: Network, side: number): Zone[] {
  if (!net.lonlat.length) return [];
  const lons = net.lonlat.map((p) => p[0]); const lats = net.lonlat.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
  const cells = new Map<number, number[]>();
  net.lonlat.forEach(([x, y], i) => {
    const cx = Math.min(side - 1, Math.floor(((x - x0) / (x1 - x0 || 1)) * side));
    const cy = Math.min(side - 1, Math.floor(((y - y0) / (y1 - y0 || 1)) * side));
    const key = cy * side + cx; (cells.get(key) ?? cells.set(key, []).get(key)!).push(i);
  });
  const zones: Zone[] = [];
  for (const [key, members] of [...cells].sort((a, b) => a[0] - b[0])) {
    const c: [number, number] = [members.reduce((s, i) => s + net.lonlat[i][0], 0) / members.length, members.reduce((s, i) => s + net.lonlat[i][1], 0) / members.length];
    // Prefer nodes that have both incoming and outgoing links so trips can start and end there.
    const connected = members.filter((i) => net.out[i].length);
    const pool = connected.length ? connected : members;
    const node = pool.reduce((best, i) => (metres(net.lonlat[i], c) < metres(net.lonlat[best], c) ? i : best), pool[0]);
    zones.push({ id: zones.length + 1, name: `${String.fromCharCode(65 + Math.floor(key / side))}${(key % side) + 1}`, node, lonlat: net.lonlat[node], weight: members.length });
  }
  return zones;
}

/** Gravity model: trips between zones proportional to their weights and decaying with free-flow time. */
export function gravityOd(net: Network, zones: readonly Zone[], totalTrips: number, beta = 0.1): number[][] {
  const t0 = net.links.map((l) => l.t0);
  const times = zones.map((z) => dijkstra(net, z.node, t0).dist);
  const raw = zones.map((a, i) => zones.map((b, j) => {
    const t = times[i][b.node];
    return i === j || !Number.isFinite(t) ? 0 : a.weight * b.weight * Math.exp(-beta * (t / 60));
  }));
  const sum = raw.flat().reduce((s, v) => s + v, 0) || 1;
  return raw.map((row) => row.map((v) => Math.round((v / sum) * totalTrips)));
}

/** BPR volume-delay function. */
export const bpr = (t0: number, v: number, c: number) => t0 * (1 + 0.15 * (v / c) ** 4);

export interface Assignment {
  readonly volume: Float64Array;
  readonly time: Float64Array;
  readonly iterations: number;
  /** Relative gap of the last iteration. */
  readonly gap: number;
  readonly unrouted: number;
}

function allOrNothing(net: Network, zones: readonly Zone[], od: number[][], cost: ArrayLike<number>): { flow: Float64Array; unrouted: number } {
  const flow = new Float64Array(net.links.length);
  let unrouted = 0;
  zones.forEach((z, i) => {
    const { dist, via } = dijkstra(net, z.node, cost);
    zones.forEach((d, j) => {
      const q = od[i][j]; if (!q) return;
      if (!Number.isFinite(dist[d.node])) { unrouted += q; return; }
      for (let v = d.node; v !== z.node; v = net.links[via[v]].from) flow[via[v]] += q;
    });
  });
  return { flow, unrouted };
}

/** User equilibrium by Frank-Wolfe with the method of successive averages step. OD is in vehicles per hour. */
export function assign(net: Network, zones: readonly Zone[], od: number[][], iterations = 30): Assignment {
  const time = Float64Array.from(net.links, (l) => l.t0);
  let { flow: volume, unrouted } = allOrNothing(net, zones, od, time);
  let gap = 1; let k = 1;
  for (; k < iterations; k++) {
    net.links.forEach((l, i) => { time[i] = bpr(l.t0, volume[i], l.cap); });
    const aux = allOrNothing(net, zones, od, time);
    let tv = 0; let ta = 0;
    for (let i = 0; i < volume.length; i++) { tv += time[i] * volume[i]; ta += time[i] * aux.flow[i]; }
    gap = tv > 0 ? (tv - ta) / tv : 0;
    const step = 1 / (k + 1);
    for (let i = 0; i < volume.length; i++) volume[i] += step * (aux.flow[i] - volume[i]);
    unrouted = aux.unrouted;
    if (gap < 1e-4) break;
  }
  net.links.forEach((l, i) => { time[i] = bpr(l.t0, volume[i], l.cap); });
  return { volume, time, iterations: k, gap, unrouted };
}

/** Nearest network node to a point. */
export function nearestNode(net: Network, p: readonly [number, number]): number {
  let best = -1; let bd = Infinity;
  net.lonlat.forEach((q, i) => { const d = metres(p, q); if (d < bd) { bd = d; best = i; } });
  return best;
}
