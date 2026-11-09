import { direction, isDrivable } from './tags';
import type { OsmDoc, OsmWay } from './types';

export const drivableWays = (doc: OsmDoc): OsmWay[] =>
  Object.values(doc.ways).filter((w) => isDrivable(w.tags) && w.refs.every((r) => doc.nodes[r]));

export interface Arc { readonly from: string; readonly to: string; readonly wayId: string }

/** Directed arcs between consecutive nodes of drivable ways, following oneway rules. */
export function directedArcs(ways: readonly OsmWay[]): Arc[] {
  return ways.flatMap((w) => {
    const dir = direction(w.tags);
    return w.refs.slice(1).flatMap((to, i) => {
      const from = w.refs[i];
      const forward = { from, to, wayId: w.id };
      const backward = { from: to, to: from, wayId: w.id };
      if (dir === 'forward') return [forward];
      if (dir === 'backward') return [backward];
      return [forward, backward];
    });
  });
}
