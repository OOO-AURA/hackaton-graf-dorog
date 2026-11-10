import type { OsmDoc, OsmWay } from '../osm/types';

/**
 * Per-way memo for map builders. Edits replace only the way and node objects they touch, so a
 * way whose object, node objects and extra inputs are the same as last time gives the same
 * features, and an edit rebuilds a handful of roads instead of the whole map.
 */
export class WayCache<T> {
  private store = new WeakMap<OsmWay, { deps: unknown[]; value: T }>();

  get(doc: OsmDoc, w: OsmWay, extra: unknown[], make: () => T): T {
    const deps: unknown[] = [...extra];
    for (const r of w.refs) deps.push(doc.nodes[r]);
    const hit = this.store.get(w);
    if (hit && hit.deps.length === deps.length && hit.deps.every((d, i) => d === deps[i])) return hit.value;
    const value = make();
    this.store.set(w, { deps, value });
    return value;
  }
}

/** A stable value for small plain inputs (tapers, radii) so they compare with ===. */
export const sig = (v: unknown): string => (v === undefined ? '' : JSON.stringify(v));
