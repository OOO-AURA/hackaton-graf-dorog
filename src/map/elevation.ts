import { isDrivable } from '../osm/tags';
import type { OsmDoc, OsmWay } from '../osm/types';
import { LAYER_STEP } from '../osm/height';

/**
 * Heights of the roads around bridges in the 3D view, as an interchange is built: the deck stands
 * at its level and the roads that lead onto it climb an embankment, coming down to the ground
 * over `APPROACH_LENGTH` metres. Ramps up to the bridge climb the same way. OSM tags only the deck
 * as a bridge, so the embankments are worked out here; the file is not changed.
 *
 * Webots builds the deck at layer × 5 m and its approaches on the ground: on the jury's 3D video
 * the deck has a step at each end. This view shows the interchange as it stands.
 */

/** Length over which an approach comes down from a 5 m deck: a grade of about 4 %, as city overpasses are built. */
export const APPROACH_LENGTH = 120;
/** Below this a road counts as being on the ground. */
const LIFT_MIN = 0.3;

const M_PER_DEG = (Math.PI / 180) * 6_371_000;
const isYes = (v: string | undefined) => Boolean(v && v !== 'no');
const isBridge = (w: OsmWay) => isYes(w.tags.bridge);
const isTunnel = (w: OsmWay) => isYes(w.tags.tunnel);

/** Deck height of a bridge: its OSM `layer` (at least 1) times one layer step. */
export function deckHeight(w: OsmWay): number {
  const layer = Number.parseInt(w.tags.layer ?? '', 10);
  return (Number.isFinite(layer) && layer > 0 ? layer : 1) * LAYER_STEP;
}

function metres(doc: OsmDoc, a: string, b: string): number {
  const [p, q] = [doc.nodes[a], doc.nodes[b]];
  const k = Math.cos((p.lat * Math.PI) / 180);
  return Math.hypot((q.lon - p.lon) * k, q.lat - p.lat) * M_PER_DEG;
}

const cache = new WeakMap<OsmDoc, Map<string, number>>();

/**
 * Height of every lifted node, metres: bridge nodes at their deck, and nodes of the ground roads
 * reached from a bridge end within an approach length, falling linearly with the distance driven.
 */
export function nodeElevations(doc: OsmDoc): Map<string, number> {
  const hit = cache.get(doc);
  if (hit) return hit;
  const z = new Map<string, number>();
  const ways = Object.values(doc.ways).filter((w) => isDrivable(w.tags) && w.refs.every((r) => doc.nodes[r]));
  // Ground roads as a graph of node neighbours with distances.
  const next = new Map<string, Array<[string, number]>>();
  const link = (a: string, b: string) => {
    const d = metres(doc, a, b);
    next.set(a, [...(next.get(a) ?? []), [b, d]]);
    next.set(b, [...(next.get(b) ?? []), [a, d]]);
  };
  ways.filter((w) => !isBridge(w) && !isTunnel(w)).forEach((w) => w.refs.slice(1).forEach((r, i) => link(w.refs[i], r)));
  const lift = (id: string, h: number) => { if (h > (z.get(id) ?? 0)) z.set(id, h); };
  for (const bridge of ways.filter(isBridge)) {
    const h = deckHeight(bridge);
    bridge.refs.forEach((r) => lift(r, h));
    // From each end, the height left after driving `d` metres down the approach.
    for (const end of [bridge.refs[0], bridge.refs[bridge.refs.length - 1]]) {
      const best = new Map<string, number>([[end, 0]]);
      const queue: Array<[string, number]> = [[end, 0]];
      while (queue.length) {
        queue.sort((a, b) => a[1] - b[1]);
        const [id, d] = queue.shift()!;
        if (d > (best.get(id) ?? Infinity)) continue;
        lift(id, h * Math.max(0, 1 - d / APPROACH_LENGTH));
        for (const [to, len] of next.get(id) ?? []) {
          const nd = d + len;
          if (nd >= APPROACH_LENGTH || nd >= (best.get(to) ?? Infinity)) continue;
          best.set(to, nd);
          queue.push([to, nd]);
        }
      }
    }
  }
  cache.set(doc, z);
  return z;
}

/** A ground road climbing an embankment somewhere along it. */
export function isLifted(doc: OsmDoc, way: OsmWay): boolean {
  if (isBridge(way) || isTunnel(way)) return false;
  const z = nodeElevations(doc);
  return way.refs.some((r) => (z.get(r) ?? 0) > LIFT_MIN);
}

export const isLiftedNode = (doc: OsmDoc, id: string) => (nodeElevations(doc).get(id) ?? 0) > LIFT_MIN;
