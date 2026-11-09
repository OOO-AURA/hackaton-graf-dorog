/**
 * Fastest route between two nodes on the road graph, like the shortest path search of PTV Visum.
 * Its main use in the editor is checking the graph: if there is no route, one-way tags or a broken
 * junction cut the network, and the jury's MATSim agents will not get through either.
 */
import { buildNetwork, dijkstra, metres } from './model';
import type { OsmDoc } from '../osm/types';

export interface Route {
  readonly found: true;
  readonly coords: Array<[number, number]>;
  readonly lengthM: number;
  /** Free-flow travel time, seconds. */
  readonly timeS: number;
  /** Street names along the route in order, repeats merged. */
  readonly streets: string[];
}

export interface NoRoute {
  readonly found: false;
  /** Why: a node is not on the drivable graph, or the destination cannot be reached. */
  readonly reason: 'not-on-graph' | 'unreachable';
  /** How many graph nodes can be reached from the start, to judge how cut off it is. */
  readonly reachableNodes: number;
}

export function fastestRoute(doc: OsmDoc, fromNodeId: string, toNodeId: string): Route | NoRoute {
  const net = buildNetwork(doc);
  const from = net.nodeIds.indexOf(fromNodeId);
  const to = net.nodeIds.indexOf(toNodeId);
  if (from < 0 || to < 0) return { found: false, reason: 'not-on-graph', reachableNodes: 0 };
  const { dist, via } = dijkstra(net, from, net.links.map((l) => l.t0));
  if (!Number.isFinite(dist[to])) {
    return { found: false, reason: 'unreachable', reachableNodes: Array.from(dist).filter(Number.isFinite).length };
  }
  const links: number[] = [];
  for (let v = to; v !== from; v = net.links[via[v]].from) links.unshift(via[v]);
  const coords: Array<[number, number]> = [net.lonlat[from], ...links.map((li) => net.lonlat[net.links[li].to])];
  const lengthM = links.reduce((s, li) => s + metres(net.links[li].coords[0], net.links[li].coords[1]), 0);
  const streets = links.map((li) => doc.ways[net.links[li].wayId]?.tags.name ?? '').filter((n, i, all) => n && n !== all[i - 1]);
  return { found: true, coords, lengthM, timeS: dist[to], streets: streets.filter((n, i) => streets.indexOf(n) === i) };
}
