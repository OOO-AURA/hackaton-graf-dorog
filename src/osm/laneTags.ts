import { lanesByDirection } from './profile';
import { direction, withTag } from './tags';
import type { Tags } from './types';

/**
 * One lane of a road in OSM: its values live in `*:lanes` tags, one entry per lane from the left
 * in the direction of travel, `|` between them (`turn:lanes`, `psv:lanes`, `width:lanes`,
 * `maxspeed:lanes`; with `:forward` / `:backward` on a two-way road).
 */

export type Travel = 'forward' | 'backward';

const isOneway = (tags: Tags) => direction(tags) !== 'both';

export function laneCount(tags: Tags, travel: Travel): number {
  const { forward, backward } = lanesByDirection(tags);
  if (tags.oneway === '-1') return travel === 'backward' ? forward : 0;
  return travel === 'forward' ? forward : backward;
}

export const laneKey = (tags: Tags, base: string, travel: Travel) => (isOneway(tags) ? base : `${base}:${travel}`);

/** Value of one lane, or '' when the tag does not give one. */
export function laneValue(tags: Tags, base: string, travel: Travel, index: number): string {
  const v = tags[laneKey(tags, base, travel)];
  return v ? (v.split('|')[index] ?? '').trim() : '';
}

/**
 * Sets the value of one lane, keeping the others. `fill` is what a lane without a value of its
 * own gets when the tag is first written; a tag left with nothing but `fill` is removed.
 */
export function setLaneValue(tags: Tags, base: string, travel: Travel, index: number, value: string, fill = ''): Tags {
  const n = laneCount(tags, travel);
  if (index < 0 || index >= n) return tags;
  const key = laneKey(tags, base, travel);
  const old = (tags[key] ?? '').split('|');
  const list = Array.from({ length: n }, (_, i) => (i === index ? value : (old.length === n ? old[i] : fill) ?? fill).trim());
  return withTag(tags, key, list.every((v) => v === fill) ? null : list.join('|'));
}

/** A lane of a road, as the lane editor shows it. */
export interface LaneInfo {
  readonly travel: Travel;
  readonly index: number;
  readonly turns: readonly string[];
  readonly psv: boolean;
  readonly width: string;
  readonly maxspeed: string;
}

export function laneInfo(tags: Tags, travel: Travel, index: number): LaneInfo {
  const turns = laneValue(tags, 'turn:lanes', travel, index);
  return {
    travel, index,
    turns: turns && turns !== 'none' ? turns.split(';').map((t) => t.trim()).filter(Boolean) : [],
    psv: laneValue(tags, 'psv:lanes', travel, index) === 'designated' || laneValue(tags, 'bus:lanes', travel, index) === 'designated',
    width: laneValue(tags, 'width:lanes', travel, index),
    maxspeed: laneValue(tags, 'maxspeed:lanes', travel, index),
  };
}

/** Writes the turns a lane may take: '' leaves it to the usual rules of the junction. */
export const setLaneTurns = (tags: Tags, travel: Travel, index: number, turns: readonly string[]) =>
  setLaneValue(tags, 'turn:lanes', travel, index, turns.join(';'));

/** Gives one lane to route vehicles and taxis, or back to all traffic. */
export function setLanePsv(tags: Tags, travel: Travel, index: number, on: boolean): Tags {
  const cleared = withTag(tags, laneKey(tags, 'bus:lanes', travel), null);
  return setLaneValue(cleared, 'psv:lanes', travel, index, on ? 'designated' : 'yes', 'yes');
}
