import { flipOneway, reverseWayTags, withTag } from './tags';
import type { OsmDoc, OsmNode, OsmWay, Tags } from './types';

const omit = <T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> => {
  const { [key]: _removed, ...rest } = record;
  return rest;
};

/**
 * Hook for marking edited objects. Deliberately a no-op: extra attributes such as JOSM's action="modify"
 * are not needed by MatSim/SUMO/Webots and every unknown attribute is a risk for the checking pipeline.
 */
const touched = <T>(obj: T): T => obj;

const dedupeConsecutive = (refs: readonly string[]) => refs.filter((r, i) => i === 0 || refs[i - 1] !== r);

const allocId = (doc: OsmDoc): [string, OsmDoc] => [String(doc.nextId), { ...doc, nextId: doc.nextId + 1 }];

function putNode(doc: OsmDoc, node: OsmNode): OsmDoc {
  return { ...doc, nodes: { ...doc.nodes, [node.id]: node } };
}

function putWay(doc: OsmDoc, way: OsmWay): OsmDoc {
  return { ...doc, ways: { ...doc.ways, [way.id]: way } };
}

export const waysOfNode = (doc: OsmDoc, nodeId: string): OsmWay[] =>
  Object.values(doc.ways).filter((w) => w.refs.includes(nodeId));

export function addNode(doc: OsmDoc, lon: number, lat: number, tags: Tags = {}): { doc: OsmDoc; id: string } {
  const [id, next] = allocId(doc);
  return { doc: putNode(next, { id, lon, lat, tags, attrs: { version: '1' } }), id };
}

export function moveNode(doc: OsmDoc, id: string, lon: number, lat: number): OsmDoc {
  const node = doc.nodes[id];
  return node ? putNode(doc, touched({ ...node, lon, lat })) : doc;
}

export function setNodeTags(doc: OsmDoc, id: string, tags: Tags): OsmDoc {
  const node = doc.nodes[id];
  return node ? putNode(doc, touched({ ...node, tags })) : doc;
}

export function setWayTags(doc: OsmDoc, id: string, tags: Tags): OsmDoc {
  const way = doc.ways[id];
  return way ? putWay(doc, touched({ ...way, tags })) : doc;
}

export function setWayTag(doc: OsmDoc, id: string, key: string, value: string | null): OsmDoc {
  const way = doc.ways[id];
  return way ? setWayTags(doc, id, withTag(way.tags, key, value)) : doc;
}

export function toggleSignal(doc: OsmDoc, nodeId: string): OsmDoc {
  const node = doc.nodes[nodeId];
  if (!node) return doc;
  const isSignal = node.tags.highway === 'traffic_signals';
  return setNodeTags(doc, nodeId, withTag(node.tags, 'highway', isSignal ? null : 'traffic_signals'));
}

/** Removes a way. Its nodes stay: they may carry tags or belong to other ways. */
export function deleteWay(doc: OsmDoc, id: string): OsmDoc {
  if (!doc.ways[id]) return doc;
  return { ...doc, ways: omit(doc.ways, id), deleted: { ...doc.deleted, [`way:${id}`]: true } };
}

export function deleteNode(doc: OsmDoc, id: string): OsmDoc {
  if (!doc.nodes[id]) return doc;
  const base: OsmDoc = { ...doc, nodes: omit(doc.nodes, id), deleted: { ...doc.deleted, [`node:${id}`]: true } };
  return waysOfNode(doc, id).reduce((acc, way) => {
    const cleaned = dedupeConsecutive(way.refs.filter((r) => r !== id));
    return cleaned.length < 2 ? deleteWay(acc, way.id) : putWay(acc, touched({ ...way, refs: cleaned }));
  }, base);
}

export function createWay(doc: OsmDoc, refs: readonly string[], tags: Tags): { doc: OsmDoc; id: string } {
  const [id, next] = allocId(doc);
  return { doc: putWay(next, { id, refs, tags, attrs: { version: '1' } }), id };
}

/** Reverses node order and adjusts direction-dependent tags: the road on the ground is unchanged. */
export function reverseWay(doc: OsmDoc, id: string): OsmDoc {
  const way = doc.ways[id];
  return way ? putWay(doc, touched({ ...way, refs: [...way.refs].reverse(), tags: reverseWayTags(way.tags) })) : doc;
}

/** Flips the allowed direction of travel of a one-way road (fixes "wrong direction" errors). */
export function flipDirection(doc: OsmDoc, id: string): OsmDoc {
  const way = doc.ways[id];
  return way ? setWayTags(doc, id, flipOneway(way.tags)) : doc;
}

/** Inserts a new node into a way after position `index` (on segment index → index+1). */
export function insertNodeInWay(doc: OsmDoc, wayId: string, index: number, lon: number, lat: number): { doc: OsmDoc; id: string } {
  const way = doc.ways[wayId];
  if (!way || index < 0 || index >= way.refs.length - 1) return { doc, id: '' };
  const added = addNode(doc, lon, lat);
  const refs = [...way.refs.slice(0, index + 1), added.id, ...way.refs.slice(index + 1)];
  return { doc: putWay(added.doc, touched({ ...way, refs })), id: added.id };
}

/** Splits a way at an inner node; the second half becomes a new way and joins the same relations. */
export function splitWay(doc: OsmDoc, wayId: string, nodeId: string): { doc: OsmDoc; newWayId: string } {
  const way = doc.ways[wayId];
  const at = way ? way.refs.indexOf(nodeId) : -1;
  if (!way || at <= 0 || at >= way.refs.length - 1) return { doc, newWayId: '' };
  const first = touched({ ...way, refs: way.refs.slice(0, at + 1) });
  const created = createWay(putWay(doc, first), way.refs.slice(at), way.tags);
  const relations = Object.fromEntries(
    Object.entries(created.doc.relations).map(([rid, rel]) => {
      const idx = rel.members.findIndex((m) => m.type === 'way' && m.ref === wayId);
      if (idx < 0) return [rid, rel];
      const members = [...rel.members.slice(0, idx + 1), { ...rel.members[idx], ref: created.id }, ...rel.members.slice(idx + 1)];
      return [rid, touched({ ...rel, members })];
    }),
  );
  return { doc: { ...created.doc, relations }, newWayId: created.id };
}

/** Merges `removeId` into `keepId`: every way uses the kept node, tags are combined. Fixes broken intersections. */
export function mergeNodes(doc: OsmDoc, keepId: string, removeId: string): OsmDoc {
  const keep = doc.nodes[keepId];
  const remove = doc.nodes[removeId];
  if (!keep || !remove || keepId === removeId) return doc;
  const rewired = waysOfNode(doc, removeId).reduce((acc, way) => {
    const refs = dedupeConsecutive(way.refs.map((r) => (r === removeId ? keepId : r)));
    return refs.length < 2 ? deleteWay(acc, way.id) : putWay(acc, touched({ ...way, refs }));
  }, setNodeTags(doc, keepId, { ...remove.tags, ...keep.tags }));
  return { ...rewired, nodes: omit(rewired.nodes, removeId), deleted: { ...rewired.deleted, [`node:${removeId}`]: true } };
}

/** Joins two ways that cross without a shared node by inserting one common node at the crossing point. */
export function connectCrossing(
  doc: OsmDoc,
  a: { wayId: string; index: number },
  b: { wayId: string; index: number },
  lon: number,
  lat: number,
): OsmDoc {
  const first = insertNodeInWay(doc, a.wayId, a.index, lon, lat);
  if (!first.id) return doc;
  const wayB = first.doc.ways[b.wayId];
  if (!wayB) return doc;
  const refs = [...wayB.refs.slice(0, b.index + 1), first.id, ...wayB.refs.slice(b.index + 1)];
  return putWay(first.doc, touched({ ...wayB, refs }));
}
