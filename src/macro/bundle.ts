/**
 * Flow bundle, as in PTV Visum: which zone-to-zone trips use a chosen road and which streets they
 * take on the way. It answers the question a jury asks about every edit: whose trips does this
 * road carry, and where would they go if it changed.
 *
 * Trips follow the shortest paths on the loaded travel times of the equilibrium assignment. This is
 * the last all-or-nothing step of Frank-Wolfe, so it shows the main routes, not the exact split
 * between equally fast ones.
 */
import { bpr, buildNetwork, dijkstra, type Network, type Zone } from './model';
import type { MacroResult } from './compute';
import type { OsmDoc } from '../osm/types';

export interface BundlePair { readonly from: string; readonly to: string; readonly trips: number }

export interface FlowBundle {
  readonly wayId: string;
  /** Trips per hour through the chosen road. */
  readonly total: number;
  /** Zone pairs ordered from the largest. */
  readonly pairs: readonly BundlePair[];
  /** Trips of the bundle on every link of the network, by link index. */
  readonly linkVolume: Float64Array;
}

export function flowBundle(net: Network, zones: readonly Zone[], od: readonly (readonly number[])[], time: ArrayLike<number>, wayId: string): FlowBundle {
  const linkVolume = new Float64Array(net.links.length);
  const pairs: BundlePair[] = [];
  zones.forEach((origin, i) => {
    const { dist, via } = dijkstra(net, origin.node, time);
    zones.forEach((dest, j) => {
      const q = od[i]?.[j] ?? 0;
      if (!q || i === j || !Number.isFinite(dist[dest.node])) return;
      const path: number[] = [];
      for (let v = dest.node; v !== origin.node && via[v] >= 0; v = net.links[via[v]].from) path.push(via[v]);
      if (!path.some((li) => net.links[li].wayId === wayId)) return;
      path.forEach((li) => { linkVolume[li] += q; });
      pairs.push({ from: origin.name, to: dest.name, trips: q });
    });
  });
  pairs.sort((a, b) => b.trips - a.trips);
  return { wayId, total: pairs.reduce((s, p) => s + p.trips, 0), pairs, linkVolume };
}

/** Loaded link times recovered from the flows of a macro result (features follow the link order). */
export function loadedTimes(net: Network, result: MacroResult): Float64Array {
  const flows = result.flows.features.filter((f) => (f as { properties: { kind: string } }).properties.kind === 'flow') as Array<{ properties: { v: number } }>;
  return Float64Array.from(net.links, (l, i) => bpr(l.t0, flows[i]?.properties.v ?? 0, l.cap));
}

/** Bundle for a road of the current document, or null when the macro result does not match it. */
export function bundleFor(doc: OsmDoc, result: MacroResult, wayId: string): { bundle: FlowBundle; net: Network } | null {
  const net = buildNetwork(doc);
  const flowCount = result.flows.features.filter((f) => (f as { properties: { kind: string } }).properties.kind === 'flow').length;
  if (flowCount !== net.links.length) return null;
  return { bundle: flowBundle(net, result.zones, result.od, loadedTimes(net, result), wayId), net };
}

/** Map features of the bundle: each link with bundle trips, width by volume. */
export function bundleFeatures(net: Network, bundle: FlowBundle): unknown[] {
  return net.links.flatMap((l, i) => (bundle.linkVolume[i] > 0
    ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: l.coords }, properties: { kind: 'bundle', v: Math.round(bundle.linkVolume[i]), share: bundle.total ? bundle.linkVolume[i] / bundle.total : 0, own: l.wayId === bundle.wayId } }]
    : []));
}
