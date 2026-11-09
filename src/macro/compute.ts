import type { OsmDoc } from '../osm/types';
import { assign, buildingMass, buildNetwork, dijkstra, gridZones, metres, pointZones, weighByBuildings, type Zone } from './model';
import { DEFAULT_BETA, meanTime, PURPOSES, purposeMatrices, roundOd, skim, solveBeta, timeHistogram } from './purposes';

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
  /** Base β of the gravity model, 1/min, and whether it came from calibration. */
  beta: number;
  calibrated: 'ok' | 'unreachable' | null;
  /** Mean trip times β can give on this fragment, from the largest to the smallest β. */
  reachable: [number, number] | null;
  /** Mean trip time on the loaded network, minutes, and its distribution. */
  meanTime: number;
  histogram: Array<{ from: number; share: number }>;
  purposes: Array<{ id: string; label: string; trips: number; meanTime: number }>;
}


export interface FlowsOptions {
  side: number;
  trips: number;
  /** Zone centroids placed by hand; the grid is used when absent. */
  points?: ReadonlyArray<readonly [number, number]> | null;
  /** Matrix edited by hand; used as is when it matches the zones. */
  od?: number[][] | null;
  /** Base β, 1/min; defaults to DEFAULT_BETA. */
  beta?: number;
  /** Mean trip time to calibrate β to, minutes; overrides `beta`. */
  targetMinutes?: number | null;
}

export function computeFlows(doc: OsmDoc, opts: FlowsOptions): MacroResult {
  const net = buildNetwork(doc);
  const base = opts.points?.length ? pointZones(net, opts.points) : gridZones(net, opts.side);
  const zones = weighByBuildings(base, buildingMass(doc));
  const free = skim(net, zones);
  let beta = opts.beta ?? DEFAULT_BETA;
  let calibrated: MacroResult['calibrated'] = null;
  let reachable: [number, number] | null = null;
  if (opts.targetMinutes) {
    // Each probe runs a short assignment, so the mean is measured on the times its own matrix loads.
    const at = (b: number) => {
      const od = roundOd(purposeMatrices(free, zones, opts.trips, b).od);
      return meanTime(od, skim(net, zones, assign(net, zones, od, 15).time));
    };
    reachable = [at(2), at(0.001)];
    const solved = solveBeta(at, opts.targetMinutes, 14, reachable);
    calibrated = solved === null ? 'unreachable' : 'ok';
    if (solved !== null) beta = solved;
  }
  const split = purposeMatrices(free, zones, opts.trips, beta);
  const edited = opts.od && opts.od.length === zones.length ? opts.od : null;
  const od = edited ?? roundOd(split.od);
  const a = assign(net, zones, od, 40);
  const loaded = skim(net, zones, a.time);
  let vkt = 0; let vht = 0; let overloaded = 0;
  const features: unknown[] = net.links.map((l, i) => {
    const v = a.volume[i]; const vc = v / l.cap;
    vkt += (v * metres(l.coords[0], l.coords[1])) / 1000;
    vht += (v * a.time[i]) / 3600;
    if (v > l.cap) overloaded++;
    return { type: 'Feature', geometry: { type: 'LineString', coordinates: l.coords }, properties: { kind: 'flow', v: Math.round(v), vc: Math.round(vc * 100) / 100, color: vcColor(vc), way: l.wayId } };
  });
  zones.forEach((z) => features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: z.lonlat }, properties: { kind: 'zone', name: z.name, idx: z.id - 1 } }));
  const purposes = PURPOSES.map((p, k) => ({
    id: p.id, label: p.label,
    trips: Math.round(split.mats[k].flat().reduce((x, v) => x + v, 0)),
    meanTime: meanTime(split.mats[k], loaded),
  }));
  return {
    zones, od, flows: { type: 'FeatureCollection', features }, iterations: a.iterations, gap: a.gap, unrouted: a.unrouted, vkt, vht, overloaded,
    beta, calibrated, reachable, meanTime: meanTime(od, loaded), histogram: timeHistogram(od, loaded, 1), purposes: edited ? [] : purposes,
  };
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
