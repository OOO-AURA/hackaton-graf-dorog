import { frame } from '../map/polyline';
import { addNode, createWay, deleteNode, waysOfNode } from './edit';
import { withBuildingLevels } from './height';
import { rectangle, translate, type BuildingTemplate, type P } from './buildingShape';
import type { OsmDoc, OsmWay, Tags } from './types';

/**
 * Buildings as nodes and a closed way, from outlines in local metres (osm/buildingShape.ts). New
 * buildings get standard tags only: building=yes, building:levels and height, so Webots builds
 * them the same height the 3D view shows.
 */

export type LonLat = [number, number];

/** Tags of a new building from a template: its storeys and the height Webots gives them. */
export const templateTags = (t: BuildingTemplate): Tags => withBuildingLevels({ building: 'yes' }, t.levels);

/** Local metres around a latitude, both ways. */
export function metres(lat0: number) {
  const f = frame(lat0);
  return { to: ([lon, lat]: LonLat): P => f.to(lon, lat), back: (p: P): LonLat => f.back(p) };
}

/** Outline of a building way: its node ids and points without the closing one. */
export function outlineOf(doc: OsmDoc, wayId: string): { refs: string[]; ring: LonLat[] } | null {
  const way = doc.ways[wayId];
  if (!way || way.refs.length < 4) return null;
  const closed = way.refs[0] === way.refs[way.refs.length - 1];
  const refs = closed ? way.refs.slice(0, -1) : [...way.refs];
  const ring = refs.map((r) => doc.nodes[r]).filter(Boolean).map((n) => [n.lon, n.lat] as LonLat);
  return ring.length === refs.length && ring.length >= 3 ? { refs, ring } : null;
}

/** A new closed way on new nodes. */
export function addBuilding(doc: OsmDoc, ring: readonly LonLat[], tags: Tags): { doc: OsmDoc; id: string } {
  let d = doc;
  const refs = ring.map(([lon, lat]) => {
    const r = addNode(d, lon, lat);
    d = r.doc;
    return r.id;
  });
  return createWay(d, [...refs, refs[0]], tags);
}

/** One of the templates, its centre at `center`, its long side on bearing `angle`. */
export function placeTemplate(doc: OsmDoc, center: LonLat, t: BuildingTemplate, angle: number): { doc: OsmDoc; id: string } {
  return addBuilding(doc, templateRing(center, t, angle), templateTags(t));
}

/** Corners of a template placed at `center`, in longitude and latitude. */
export function templateRing(center: LonLat, t: BuildingTemplate, angle: number): LonLat[] {
  const m = metres(center[1]);
  return rectangle(m.to(center), t.width, t.length, angle).map(m.back);
}

/**
 * Gives a building a new outline. Its nodes move to the new points in order; extra points get new
 * nodes, and nodes left over go unless another way still uses them.
 */
export function setOutline(doc: OsmDoc, wayId: string, ring: readonly LonLat[]): OsmDoc {
  const cur = outlineOf(doc, wayId);
  const way = doc.ways[wayId];
  if (!cur || !way || ring.length < 3) return doc;
  let d = doc;
  const refs = ring.map(([lon, lat], i) => {
    const id = cur.refs[i];
    if (id) {
      const n = d.nodes[id];
      d = { ...d, nodes: { ...d.nodes, [id]: { ...n, lon, lat } } };
      return id;
    }
    const r = addNode(d, lon, lat);
    d = r.doc;
    return r.id;
  });
  const next: OsmWay = { ...d.ways[wayId], refs: [...refs, refs[0]] };
  d = { ...d, ways: { ...d.ways, [wayId]: next } };
  for (const id of cur.refs.slice(ring.length)) {
    const n = d.nodes[id];
    if (n && !Object.keys(n.tags).length && waysOfNode(d, id).length === 0) d = deleteNode(d, id);
  }
  return d;
}

/** Outline of a building in local metres, and the way back to longitude and latitude. */
export function localOutline(doc: OsmDoc, wayId: string) {
  const cur = outlineOf(doc, wayId);
  if (!cur) return null;
  const m = metres(cur.ring[0][1]);
  return { ring: cur.ring.map(m.to), back: (pts: readonly P[]) => pts.map(m.back), m };
}

/** Applies a change made in metres to a building's outline. */
export function reshape(doc: OsmDoc, wayId: string, change: (ring: P[]) => P[]): OsmDoc {
  const local = localOutline(doc, wayId);
  return local ? setOutline(doc, wayId, local.back(change(local.ring))) : doc;
}

/** A copy of a building `offset` metres away, on its own nodes, with the same tags. */
export function duplicateBuilding(doc: OsmDoc, wayId: string, offset: P): { doc: OsmDoc; id: string } {
  const local = localOutline(doc, wayId);
  const way = doc.ways[wayId];
  if (!local || !way) return { doc, id: '' };
  return addBuilding(doc, local.back(translate(local.ring, offset)), way.tags);
}

/** Removes a building and the nodes only it used. */
export function deleteBuilding(doc: OsmDoc, wayId: string): OsmDoc {
  const cur = outlineOf(doc, wayId);
  if (!cur) return doc;
  let d: OsmDoc = { ...doc, ways: Object.fromEntries(Object.entries(doc.ways).filter(([id]) => id !== wayId)), deleted: { ...doc.deleted, [`way:${wayId}`]: true } };
  for (const id of cur.refs) {
    const n = d.nodes[id];
    if (n && !Object.keys(n.tags).length && waysOfNode(d, id).length === 0) d = deleteNode(d, id);
  }
  return d;
}

