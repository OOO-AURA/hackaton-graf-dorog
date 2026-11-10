import { addNode, splitWay } from './edit';
import { isRailLine } from './rail';
import { isDrivable } from './tags';
import type { OsmDoc, OsmWay } from './types';

/**
 * Working on part of a road: the stretch of a way between two points where other roads join it,
 * detaching one road from a junction, and keeping car roads and tracks apart.
 */

/** A stretch of a way: refs from index `from` to index `to`, both included. */
export interface Piece { readonly from: number; readonly to: number }

/** Nodes where another road or track meets this way: the ends of the stretches it falls into. */
function joins(doc: OsmDoc, way: OsmWay): Set<string> {
  const out = new Set<string>();
  for (const w of Object.values(doc.ways)) {
    if (w.id === way.id || (!isDrivable(w.tags) && !isRailLine(w.tags))) continue;
    w.refs.forEach((r) => out.add(r));
  }
  return out;
}

/**
 * The stretch around segment `index` (between refs[index] and refs[index + 1]): out to the nearest
 * point on each side where another road joins, or the end of the way. Null when that is the whole way.
 */
export function pieceAround(doc: OsmDoc, wayId: string, index: number): Piece | null {
  const way = doc.ways[wayId];
  if (!way) return null;
  const at = joins(doc, way);
  let from = Math.max(0, Math.min(index, way.refs.length - 2));
  let to = from + 1;
  while (from > 0 && !at.has(way.refs[from])) from -= 1;
  while (to < way.refs.length - 1 && !at.has(way.refs[to])) to += 1;
  return from === 0 && to === way.refs.length - 1 ? null : { from, to };
}

/**
 * Cuts the stretch out of its way so it can be edited alone. The stretch keeps the way's id, so
 * an edit written for that id lands on it; the parts before and after become ways of their own,
 * with the same tags and in the same relations.
 */
export function isolatePiece(doc: OsmDoc, wayId: string, piece: Piece): OsmDoc {
  const way = doc.ways[wayId];
  if (!way) return doc;
  const [a, b] = [way.refs[piece.from], way.refs[piece.to]];
  let d = doc;
  // Split after the stretch: the way keeps start..b, the new one b..end.
  if (piece.to < way.refs.length - 1) d = splitWay(d, wayId, b).doc;
  // Split before it: the way keeps start..a, the new one a..b is the stretch; swap them round.
  if (piece.from > 0) {
    const r = splitWay(d, wayId, a);
    d = r.doc;
    const [head, stretch] = [d.ways[wayId], d.ways[r.newWayId]];
    d = { ...d, ways: { ...d.ways, [wayId]: { ...head, refs: stretch.refs }, [r.newWayId]: { ...stretch, refs: head.refs } } };
  }
  return d;
}

/**
 * Takes one road off a junction: it gets a node of its own a couple of metres along it, so the
 * two can be dragged apart. Returns the new node, or none when the way does not pass the node.
 */
export function detachWay(doc: OsmDoc, nodeId: string, wayId: string): { doc: OsmDoc; nodeId: string } {
  const way = doc.ways[wayId];
  const node = doc.nodes[nodeId];
  const i = way?.refs.indexOf(nodeId) ?? -1;
  if (!way || !node || i < 0) return { doc, nodeId: '' };
  const next = doc.nodes[way.refs[i === way.refs.length - 1 ? i - 1 : i + 1]];
  // A couple of metres towards the way's next node, so the new node does not sit on the old one.
  const k = next ? Math.min(1, 2 / Math.max(1, Math.hypot((next.lon - node.lon) * 68_000, (next.lat - node.lat) * 111_000))) : 0;
  const added = addNode(doc, node.lon + (next ? (next.lon - node.lon) * k : 0), node.lat + (next ? (next.lat - node.lat) * k : 0));
  const refs = way.refs.map((r) => (r === nodeId ? added.id : r));
  return { doc: { ...added.doc, ways: { ...added.doc.ways, [wayId]: { ...way, refs } } }, nodeId: added.id };
}

/** Car roads and tracks are separate networks: a road may not join a tram or railway track. */
export function mayJoin(doc: OsmDoc, a: string, b: string): boolean {
  const kinds = (id: string) => {
    const ways = Object.values(doc.ways).filter((w) => w.refs.includes(id));
    return { road: ways.some((w) => isDrivable(w.tags)), rail: ways.some((w) => isRailLine(w.tags)) };
  };
  const [ka, kb] = [kinds(a), kinds(b)];
  return !((ka.road && kb.rail && !kb.road) || (ka.rail && !ka.road && kb.road));
}

/** Whether a node or way belongs to the track network only. */
export const isTrackOnlyNode = (doc: OsmDoc, nodeId: string) => {
  const ways = Object.values(doc.ways).filter((w) => w.refs.includes(nodeId));
  return ways.length > 0 && ways.every((w) => isRailLine(w.tags));
};
