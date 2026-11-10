import { direction } from './tags';
import type { Tags } from './types';

/**
 * Design profile of a street category. Lane widths and design speeds follow
 * СП 42.13330.2016 (table 11.2) for city streets and СП 34.13330.2021 for roads;
 * per-lane capacity is the practical value used for planning estimates.
 */
export interface RoadProfile {
  readonly category: string;
  readonly laneWidth: number;
  readonly designSpeed: number;
  /** Vehicles per hour per lane. */
  readonly laneCapacity: number;
}

const PROFILES: Readonly<Record<string, RoadProfile>> = {
  motorway: { category: 'Автомагистраль, IА', laneWidth: 3.75, designSpeed: 110, laneCapacity: 2000 },
  trunk: { category: 'Магистральная непрерывного движения', laneWidth: 3.75, designSpeed: 100, laneCapacity: 1800 },
  primary: { category: 'Магистральная регулируемого движения', laneWidth: 3.5, designSpeed: 80, laneCapacity: 1200 },
  secondary: { category: 'Магистральная районного значения', laneWidth: 3.5, designSpeed: 60, laneCapacity: 1000 },
  tertiary: { category: 'Улица местного значения', laneWidth: 3.25, designSpeed: 50, laneCapacity: 800 },
  unclassified: { category: 'Улица местного значения', laneWidth: 3.0, designSpeed: 40, laneCapacity: 700 },
  residential: { category: 'Улица в жилой застройке', laneWidth: 3.0, designSpeed: 40, laneCapacity: 600 },
  living_street: { category: 'Жилая зона', laneWidth: 3.0, designSpeed: 20, laneCapacity: 300 },
  service: { category: 'Проезд', laneWidth: 3.0, designSpeed: 20, laneCapacity: 300 },
};

export function roadProfile(tags: Tags): RoadProfile | null {
  return PROFILES[(tags.highway ?? '').replace(/_link$/, '')] ?? null;
}

const int = (v: string | undefined) => { const n = parseInt(v ?? '', 10); return Number.isFinite(n) && n > 0 ? n : 0; };

/** Lanes per direction, falling back to one lane each way when nothing is tagged. */
export function lanesByDirection(tags: Tags): { forward: number; backward: number } {
  const dir = direction(tags);
  const total = int(tags.lanes);
  if (dir !== 'both') return { forward: Math.max(1, total), backward: 0 };
  const f = int(tags['lanes:forward']);
  const b = int(tags['lanes:backward']);
  // One direction tagged: the other gets what is left of the total.
  if (f || b) return { forward: Math.max(1, f || total - b), backward: Math.max(1, b || total - f) };
  const half = Math.max(1, Math.floor(total / 2));
  return { forward: half, backward: Math.max(1, total - half) };
}

/** Capacity of the busier direction, vehicles per hour. */
export function capacity(tags: Tags): number {
  const p = roadProfile(tags);
  if (!p) return 0;
  const { forward, backward } = lanesByDirection(tags);
  return Math.max(forward, backward) * p.laneCapacity;
}

/** Tags that bring the road to its category norm: width and speed limit when missing. */
export function normTags(tags: Tags): Tags {
  const p = roadProfile(tags);
  if (!p) return tags;
  const { forward, backward } = lanesByDirection(tags);
  const width = ((forward + backward) * p.laneWidth).toFixed(1);
  return { ...tags, width: tags.width ?? width, maxspeed: tags.maxspeed ?? String(Math.min(p.designSpeed, 60)) };
}

/**
 * Tags after setting one of the lane counts of a road, the others kept in step: a new total
 * shares itself out between the two directions in the same proportion as before, a new count
 * for one direction changes the total. Otherwise `lanes:forward` and `lanes:backward`, which
 * win over `lanes`, would leave an edited total without effect.
 */
export function withLaneCount(tags: Tags, key: 'lanes' | 'lanes:forward' | 'lanes:backward', value: string | null): Tags {
  const out: Record<string, string> = { ...tags };
  const set = (k: string, v: string | null) => { if (v === null || v === '') delete out[k]; else out[k] = v; };
  set(key, value);
  if (direction(tags) !== 'both') return out;
  const n = int(value ?? '');
  const hasSplit = Boolean(tags['lanes:forward'] || tags['lanes:backward']);
  if (key === 'lanes') {
    if (!hasSplit) return out;
    if (n < 2) { set('lanes:forward', null); set('lanes:backward', null); return out; }
    const { forward, backward } = lanesByDirection(tags);
    const f = Math.min(n - 1, Math.max(1, Math.round((n * forward) / (forward + backward))));
    set('lanes:forward', String(f));
    set('lanes:backward', String(n - f));
    return out;
  }
  // A count for one direction: the other keeps what it had, and the total follows.
  const { forward, backward } = lanesByDirection(tags);
  const other = key === 'lanes:forward' ? 'lanes:backward' : 'lanes:forward';
  if (!n) return out;
  const kept = key === 'lanes:forward' ? backward : forward;
  set(other, String(kept));
  set('lanes', String(n + kept));
  return out;
}
