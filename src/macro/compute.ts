import type { OsmDoc } from '../osm/types';
import { assign, buildNetwork, dijkstra, gravityOd, gridZones, metres, type Zone } from './model';

/** Load bands by volume to capacity ratio. */
export const VC_BANDS = [
  { max: 0.5, color: '#3D9F47', label: 'до 0,5' },
  { max: 0.75, color: '#F0BC2A', label: '0,5–0,75' },
  { max: 1, color: '#F09131', label: '0,75–1' },
  { max: Infinity, color: '#E5392A', label: 'больше 1' },
] as const;
export const vcColor = (vc: number) => VC_BANDS.find((b) => vc <= b.max)!.color;

export const ISO_BANDS = [
  { max: 120, color: '#3D9F47', label: 'до 2 мин' },
  { max: 300, color: '#F0BC2A', label: '2–5 мин' },
  { max: 600, color: '#F09131', label: '5–10 мин' },
  { max: Infinity, color: '#E5392A', label: 'дольше 10 мин' },
] as const;

export type Fc = { type: 'FeatureCollection'; features: unknown[] };

export interface MacroResult {
  zones: Zone[];
  od: number[][];
  flows: Fc;
  iterations: number;
  gap: number;
  unrouted: number;
  vkt: number;
  vht: number;
  overloaded: number;
}


export function computeFlows(doc: OsmDoc, side: number, trips: number): MacroResult {
  const net = buildNetwork(doc);
  const zones = gridZones(net, side);
  const od = gravityOd(net, zones, trips);
  const a = assign(net, zones, od, 40);
  let vkt = 0; let vht = 0; let overloaded = 0;
  const features: unknown[] = net.links.map((l, i) => {
    const v = a.volume[i]; const vc = v / l.cap;
    vkt += (v * metres(l.coords[0], l.coords[1])) / 1000;
    vht += (v * a.time[i]) / 3600;
    if (v > l.cap) overloaded++;
    return { type: 'Feature', geometry: { type: 'LineString', coordinates: l.coords }, properties: { kind: 'flow', v: Math.round(v), vc: Math.round(vc * 100) / 100, color: vcColor(vc), way: l.wayId } };
  });
  zones.forEach((z) => features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: z.lonlat }, properties: { kind: 'zone', name: z.name } }));
  return { zones, od, flows: { type: 'FeatureCollection', features }, iterations: a.iterations, gap: a.gap, unrouted: a.unrouted, vkt, vht, overloaded };
}

export function computeIsochrone(doc: OsmDoc, nodeId: string): Fc | null {
  const net = buildNetwork(doc);
  const src = net.nodeIds.indexOf(nodeId);
  if (src < 0) return null;
  const { dist } = dijkstra(net, src, net.links.map((l) => l.t0));
  const features = net.lonlat.flatMap((p, i) => (Number.isFinite(dist[i])
    ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: { kind: 'iso', t: Math.round(dist[i]), color: ISO_BANDS.find((b) => dist[i] <= b.max)!.color } }]
    : []));
  return { type: 'FeatureCollection', features };
}
