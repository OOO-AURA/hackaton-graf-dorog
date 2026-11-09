import type { Attrs, OsmDoc, OsmMember, OsmNode, OsmRelation, OsmWay } from './types';

export class OsmParseError extends Error {}

const MEMBER_TYPES = new Set(['node', 'way', 'relation']);

function readAttrs(el: Element, skip: readonly string[]): Record<string, string> {
  return Object.fromEntries(
    Array.from(el.attributes).filter((a) => !skip.includes(a.name)).map((a) => [a.name, a.value]),
  );
}

function readTags(el: Element): Record<string, string> {
  return Object.fromEntries(
    Array.from(el.children)
      .filter((c) => c.tagName === 'tag')
      .map((t) => [t.getAttribute('k') ?? '', t.getAttribute('v') ?? '']),
  );
}

function childrenByTag(el: Element, tag: string): Element[] {
  return Array.from(el.children).filter((c) => c.tagName === tag);
}

function readNode(el: Element): OsmNode | null {
  const id = el.getAttribute('id');
  const lat = Number.parseFloat(el.getAttribute('lat') ?? '');
  const lon = Number.parseFloat(el.getAttribute('lon') ?? '');
  if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { id, lat, lon, tags: readTags(el), attrs: readAttrs(el, ['id', 'lat', 'lon']) };
}

function readWay(el: Element): OsmWay | null {
  const id = el.getAttribute('id');
  if (!id) return null;
  const refs = childrenByTag(el, 'nd').map((nd) => nd.getAttribute('ref') ?? '').filter(Boolean);
  return { id, refs, tags: readTags(el), attrs: readAttrs(el, ['id']) };
}

function readRelation(el: Element): OsmRelation | null {
  const id = el.getAttribute('id');
  if (!id) return null;
  const members: OsmMember[] = childrenByTag(el, 'member')
    .map((m) => ({
      type: (m.getAttribute('type') ?? '') as OsmMember['type'],
      ref: m.getAttribute('ref') ?? '',
      role: m.getAttribute('role') ?? '',
    }))
    .filter((m) => MEMBER_TYPES.has(m.type) && m.ref);
  return { id, members, tags: readTags(el), attrs: readAttrs(el, ['id']) };
}

function indexById<T extends { id: string }>(items: Array<T | null>): Record<string, T> {
  return Object.fromEntries(items.filter((x): x is T => x !== null).map((x) => [x.id, x]));
}

function maxId(...groups: Array<Record<string, unknown>>): number {
  return groups.flatMap((g) => Object.keys(g)).reduce((m, id) => Math.max(m, Number(id) || 0), 0);
}

/** Parses OSM XML without dropping anything: every node, way, relation, tag and attribute is kept. */
export function parseOsm(xml: string): OsmDoc {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) throw new OsmParseError('Файл не является корректным XML');
  const root = doc.documentElement;
  if (root.tagName !== 'osm') throw new OsmParseError('Ожидался корневой элемент <osm>');

  const boundsEl = childrenByTag(root, 'bounds')[0];
  const nodes = indexById(childrenByTag(root, 'node').map(readNode));
  const ways = indexById(childrenByTag(root, 'way').map(readWay));
  const relations = indexById(childrenByTag(root, 'relation').map(readRelation));
  const bounds: Attrs | null = boundsEl ? readAttrs(boundsEl, []) : null;

  return {
    rootAttrs: readAttrs(root, []),
    bounds,
    nodes,
    ways,
    relations,
    nextId: maxId(nodes, ways, relations) + 1,
    deleted: {},
  };
}
