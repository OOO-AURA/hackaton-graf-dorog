import { lanesByDirection } from './profile';
import { direction, withTag } from './tags';
import type { Tags } from './types';

/**
 * A lane for route vehicles and taxis (signs 5.11.1, 5.14 of the Russian rules; in OSM `psv`,
 * public service vehicles): the rightmost lane of a direction, written per lane in `psv:lanes`
 * (`psv:lanes:forward` / `:backward` on two-way roads), lanes from left to right in the direction
 * of travel: `yes|yes|designated`. SUMO netconvert reads it with `--osm.lane-access` and lets only
 * buses and taxis use that lane; `lanes:psv` alone it ignores.
 */

export type Travel = 'forward' | 'backward';

const LIST_KEYS = ['psv:lanes', 'bus:lanes'] as const;

const isOneway = (tags: Tags) => direction(tags) !== 'both';

/** Lanes travelling each way, in the way's terms (a oneway=-1 road travels backward). */
function travelLanes(tags: Tags): Record<Travel, number> {
  const { forward, backward } = lanesByDirection(tags);
  return tags.oneway === '-1' ? { forward: 0, backward: forward } : { forward, backward };
}

/** Tag listing the lanes of one direction of travel. */
function keyFor(tags: Tags, base: string, travel: Travel): string {
  return isOneway(tags) ? base : `${base}:${travel}`;
}

/** Indices (from the left, in the direction of travel) of the lanes for route vehicles and taxis. */
export function psvLanes(tags: Tags, travel: Travel): Set<number> {
  const out = new Set<number>();
  if (isOneway(tags) && travelLanes(tags)[travel] === 0) return out;
  for (const base of LIST_KEYS) {
    const value = tags[keyFor(tags, base, travel)];
    if (!value) continue;
    value.split('|').forEach((v, i) => { if (v.trim() === 'designated') out.add(i); });
  }
  return out;
}

export const hasPsvLane = (tags: Tags, travel: Travel) => psvLanes(tags, travel).size > 0;

/** A direction needs two lanes for one of them to be given to buses: cars keep the other. */
export const canHavePsvLane = (tags: Tags, travel: Travel) => travelLanes(tags)[travel] >= 2;

/**
 * Gives the rightmost lane of a direction to route vehicles and taxis, or takes it back. Returns
 * the tags unchanged when the direction has fewer than two lanes.
 */
export function setPsvLane(tags: Tags, travel: Travel, on: boolean): Tags {
  const keys = LIST_KEYS.map((base) => keyFor(tags, base, travel));
  const cleared = keys.reduce((t, k) => withTag(t, k, null), tags);
  if (!on) return cleared;
  const n = travelLanes(tags)[travel];
  if (n < 2) return tags;
  const lanes = Array.from({ length: n }, (_, i) => (i === n - 1 ? 'designated' : 'yes'));
  return withTag(cleared, keyFor(tags, 'psv:lanes', travel), lanes.join('|'));
}

/** Directions of travel a road has, for its inspector. */
export const travels = (tags: Tags): Travel[] => {
  const n = travelLanes(tags);
  return (['forward', 'backward'] as const).filter((t) => n[t] > 0);
};
