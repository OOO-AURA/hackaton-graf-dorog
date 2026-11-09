/**
 * A street as one object: every drivable way with the same name.
 *
 * In OSM a street is cut into many ways (at every junction, bridge or change of attributes).
 * Setting lanes or speed one way at a time is slow and easy to get half done, which leaves a
 * street with a capacity jump in the middle. Group edits change all parts in one undo step.
 */
import { haversine } from './geo';
import { normTags } from './profile';
import { isDrivable, withTag } from './tags';
import type { OsmDoc, OsmWay, Tags } from './types';

export const streetWays = (doc: OsmDoc, name: string): OsmWay[] =>
  Object.values(doc.ways).filter((w) => w.tags.name === name && isDrivable(w.tags));

/** Value shared by every part, `null` when parts differ, '' when no part has the tag. */
export function commonValue(ways: readonly OsmWay[], key: string): string | null {
  const values = new Set(ways.map((w) => w.tags[key] ?? ''));
  return values.size === 1 ? [...values][0] : null;
}

export function streetLengthM(doc: OsmDoc, ways: readonly OsmWay[]): number {
  return ways.reduce((sum, w) => sum + w.refs.slice(1).reduce((s, r, i) => {
    const a = doc.nodes[w.refs[i]];
    const b = doc.nodes[r];
    return a && b ? s + haversine([a.lon, a.lat], [b.lon, b.lat]) : s;
  }, 0), 0);
}

function mapStreet(doc: OsmDoc, name: string, change: (tags: Tags) => Tags): OsmDoc {
  const ways = streetWays(doc, name);
  const changed = ways.map((w) => ({ w, tags: change(w.tags) })).filter(({ w, tags }) => tags !== w.tags && JSON.stringify(tags) !== JSON.stringify(w.tags));
  if (!changed.length) return doc;
  return { ...doc, ways: { ...doc.ways, ...Object.fromEntries(changed.map(({ w, tags }) => [w.id, { ...w, tags }])) } };
}

/** Sets (or removes, with null) one tag on every part of the street. */
export function setStreetTag(doc: OsmDoc, name: string, key: string, value: string | null): OsmDoc {
  return mapStreet(doc, name, (tags) => withTag(tags, key, value));
}

/**
 * Total lanes on every part of the street. Per-direction counts are dropped because they would
 * contradict the new total. On a divided street each one-way carriageway gets the same number,
 * so the value means "lanes per carriageway" there.
 */
export function setStreetLanes(doc: OsmDoc, name: string, lanes: string | null): OsmDoc {
  return mapStreet(doc, name, (tags) => {
    const base = withTag(withTag(tags, 'lanes:forward', null), 'lanes:backward', null);
    return withTag(base, 'lanes', lanes);
  });
}

/** Fills missing width and speed limit by the SP norms on every part, like the per-road button. */
export function normaliseStreet(doc: OsmDoc, name: string): OsmDoc {
  return mapStreet(doc, name, normTags);
}
