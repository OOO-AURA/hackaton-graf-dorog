import { isDrivable } from '../osm/tags';
import { isRailWay } from '../osm/rail';
import { isParkingArea } from '../osm/parking';
import type { OsmDoc, OsmWay } from '../osm/types';
import type { Lens } from './lens';

/**
 * What can be picked and edited in each view mode. A mode is a job: in the general car view the
 * roads, lanes and junctions are worked on, so signs, lights, rails and footways neither light
 * up nor take clicks; in the signs view it is the other way round, and so on. «Все объекты»
 * keeps everything open; the load view is for looking only.
 */

export type ObjectKind = 'road' | 'junction' | 'control' | 'walk' | 'rail' | 'transit' | 'building' | 'parking' | 'other';

const ALL: readonly ObjectKind[] = ['road', 'junction', 'control', 'walk', 'rail', 'transit', 'building', 'parking', 'other'];

export const EDITABLE: Readonly<Record<Lens, ReadonlySet<ObjectKind>>> = {
  all: new Set(ALL),
  car: new Set(['road', 'junction', 'parking']),
  signs: new Set(['control']),
  walk: new Set(['walk']),
  transit: new Set(['transit', 'rail']),
  rail: new Set(['rail']),
  metro: new Set(['rail']),
  load: new Set(),
};

/** Tools that make sense in each mode; the others are greyed out and the map falls back to selecting. */
export const TOOLS_IN: Readonly<Record<Lens, ReadonlySet<string>>> = {
  all: new Set(['view', 'select', 'draw', 'insert', 'building', 'parking', 'signal']),
  car: new Set(['view', 'select', 'draw', 'insert', 'parking']),
  signs: new Set(['view', 'select', 'signal']),
  walk: new Set(['view', 'select', 'draw', 'insert', 'signal']),
  transit: new Set(['view', 'select', 'draw', 'insert', 'signal']),
  rail: new Set(['view', 'select', 'draw', 'insert', 'signal']),
  metro: new Set(['view', 'select', 'draw', 'insert', 'signal']),
  load: new Set(['view']),
};

const WALK_HIGHWAY = new Set(['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'bridleway', 'corridor']);
const CONTROL_HIGHWAY = new Set(['traffic_signals', 'stop', 'give_way']);

export function wayKind(w: OsmWay): ObjectKind {
  // A multi-storey car park is a building too; it is picked and edited as a car park.
  if (isParkingArea(w)) return 'parking';
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
  if (CONTROL_HIGHWAY.has(h) || n.tags.traffic_sign || n.tags.traffic_calming) out.add('control');
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
  // In the walking view a road is picked for its sidewalks (the inspector shows only those).
  if (lens === 'walk' && k === 'road') return true;
  return EDITABLE[lens].has(k) || (k === 'rail' && w.tags.railway === 'tram' && EDITABLE[lens].has('transit'));
};

const WALK_TEMPLATE = new Set(['footway', 'pedestrian', 'cycleway', 'steps']);

/** Ready-made pieces each view mode offers in the capsule: only what that job needs. */
export const PRESETS: Readonly<Record<Lens, {
  road: (tags: Readonly<Record<string, string>>) => boolean;
  sign: (code: string) => boolean;
  station: (id: string) => boolean;
}>> = {
  all: { road: () => true, sign: () => true, station: () => true },
  car: { road: (t) => isDrivable(t), sign: () => false, station: () => false },
  signs: { road: () => false, sign: () => true, station: () => false },
  walk: { road: (t) => WALK_TEMPLATE.has(t.highway ?? ''), sign: (c) => c === '5.19' || c === 'signal_ped', station: (id) => id === 'subway_entrance' },
  transit: { road: (t) => t.railway === 'tram', sign: (c) => c === '5.16', station: (id) => id === 'tram_stop' },
  rail: { road: (t) => t.railway === 'rail', sign: () => false, station: (id) => id === 'station' || id === 'halt' },
  metro: { road: (t) => t.railway === 'subway', sign: () => false, station: (id) => id === 'subway_station' || id === 'subway_entrance' },
  load: { road: () => false, sign: () => false, station: () => false },
};
