import { isDrivable } from '../osm/tags';
import { isRailWay } from '../osm/rail';
import type { OsmDoc, OsmWay } from '../osm/types';
import type { Lens } from './lens';

/**
 * What can be picked and edited in each view mode. A mode is a job: in the general car view the
 * roads, lanes and junctions are worked on, so signs, lights, rails and footways neither light
 * up nor take clicks; in the signs view it is the other way round, and so on. «Все объекты»
 * keeps everything open; the load view is for looking only.
 */

export type ObjectKind = 'road' | 'junction' | 'control' | 'walk' | 'rail' | 'transit' | 'building' | 'other';

const ALL: readonly ObjectKind[] = ['road', 'junction', 'control', 'walk', 'rail', 'transit', 'building', 'other'];

export const EDITABLE: Readonly<Record<Lens, ReadonlySet<ObjectKind>>> = {
  all: new Set(ALL),
  car: new Set(['road', 'junction']),
  signs: new Set(['control']),
  walk: new Set(['walk']),
  transit: new Set(['transit', 'rail']),
  rail: new Set(['rail']),
  metro: new Set(['rail']),
  load: new Set(),
};

/** Tools that make sense in each mode; the others are greyed out and the map falls back to selecting. */
export const TOOLS_IN: Readonly<Record<Lens, ReadonlySet<string>>> = {
  all: new Set(['view', 'select', 'draw', 'insert', 'building', 'signal']),
  car: new Set(['view', 'select', 'draw', 'insert']),
  signs: new Set(['view', 'select', 'signal']),
  walk: new Set(['view', 'select', 'draw', 'insert', 'signal']),
  transit: new Set(['view', 'select', 'draw', 'insert']),
  rail: new Set(['view', 'select', 'draw', 'insert']),
  metro: new Set(['view', 'select']),
  load: new Set(['view']),
};

const WALK_HIGHWAY = new Set(['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'bridleway', 'corridor']);
const CONTROL_HIGHWAY = new Set(['traffic_signals', 'stop', 'give_way']);

export function wayKind(w: OsmWay): ObjectKind {
  if (w.tags.building) return 'building';
  if (isRailWay(w.tags)) return 'rail';
  if (WALK_HIGHWAY.has(w.tags.highway ?? '')) return 'walk';
  if (isDrivable(w.tags)) return 'road';
  return 'other';
}

/** Ways through every node, worked out once per document. */
const waysAt = new WeakMap<OsmDoc, Map<string, OsmWay[]>>();
function waysOf(doc: OsmDoc, id: string): OsmWay[] {
  let index = waysAt.get(doc);
  if (!index) {
    index = new Map();
    for (const w of Object.values(doc.ways)) for (const r of w.refs) { const l = index.get(r) ?? []; l.push(w); index.set(r, l); }
    waysAt.set(doc, index);
  }
  return index.get(id) ?? [];
}

/** What a node is, as one or more kinds: a crossing is both a control and a footway point. */
export function nodeKinds(doc: OsmDoc, id: string): Set<ObjectKind> {
  const n = doc.nodes[id];
  const out = new Set<ObjectKind>();
  if (!n) return out;
  const h = n.tags.highway ?? '';
  if (CONTROL_HIGHWAY.has(h)) out.add('control');
  if (h === 'crossing' || n.tags.crossing) { out.add('control'); out.add('walk'); }
  if (h === 'bus_stop' || n.tags.public_transport || ['tram_stop', 'station', 'halt', 'platform', 'subway_entrance'].includes(n.tags.railway ?? '')) out.add('transit');
  const ways = waysOf(doc, id);
  const drivable = ways.filter((w) => wayKind(w) === 'road');
  if (drivable.length > 1) out.add('junction');
  // A light, sign or crossing in the middle of a road is that object, not a point of the road:
  // in the general car view it is out of reach.
  else if (drivable.length === 1 && !out.has('control')) out.add('road');
  for (const w of ways) {
    const k = wayKind(w);
    if (k === 'rail') { out.add('rail'); if (w.tags.railway === 'tram') out.add('transit'); }
    if (k === 'walk') out.add('walk');
    if (k === 'building') out.add('building');
  }
  if (!out.size) out.add('other');
  return out;
}

export const canPickNode = (doc: OsmDoc, lens: Lens, id: string): boolean => {
  const allowed = EDITABLE[lens];
  for (const k of nodeKinds(doc, id)) if (allowed.has(k)) return true;
  return false;
};

export const canPickWay = (doc: OsmDoc, lens: Lens, id: string): boolean => {
  const w = doc.ways[id];
  if (!w) return false;
  const k = wayKind(w);
  // Tram tracks are public transport too.
  return EDITABLE[lens].has(k) || (k === 'rail' && w.tags.railway === 'tram' && EDITABLE[lens].has('transit'));
};
