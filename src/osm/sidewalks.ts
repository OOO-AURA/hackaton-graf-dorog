import type { Tags } from './types';
import { withTag } from './tags';

/**
 * Sidewalks of a road in the standard OSM tags: `sidewalk=both|left|right|no` (left and right of
 * the way's direction), and their width and surface as `sidewalk:<side>:width|surface`, with
 * `both` when the two sides are the same.
 */

export type SidewalkSides = 'both' | 'left' | 'right' | 'no';

export const SIDEWALK_W = 2.25;

/** Sides tagged on the road, or null when it says nothing. */
export function taggedSidewalks(tags: Tags): SidewalkSides | null {
  const v = tags.sidewalk ?? tags['sidewalk:both'];
  if (v === 'both' || v === 'yes') return 'both';
  if (v === 'left' || v === 'right' || v === 'no') return v;
  if (v === 'none' || v === 'separate') return 'no';
  const l = tags['sidewalk:left'] === 'yes';
  const r = tags['sidewalk:right'] === 'yes';
  if (l || r) return l && r ? 'both' : l ? 'left' : 'right';
  return null;
}

const SIDE_KEYS = ['sidewalk:left', 'sidewalk:right', 'sidewalk:both'] as const;

/** Sets the sides; width and surface move to the keys of the sides that stay. */
export function withSidewalks(tags: Tags, sides: SidewalkSides): Tags {
  const width = sidewalkWidth(tags);
  const surface = sidewalkSurface(tags);
  let t = tags;
  for (const k of [...SIDE_KEYS, 'sidewalk:width', 'sidewalk:surface']) t = withTag(t, k, null);
  for (const k of SIDE_KEYS) { t = withTag(t, `${k}:width`, null); t = withTag(t, `${k}:surface`, null); }
  t = withTag(t, 'sidewalk', sides);
  if (sides !== 'no') {
    const key = `sidewalk:${sides}`;
    if (width !== null) t = withTag(t, `${key}:width`, String(width));
    if (surface) t = withTag(t, `${key}:surface`, surface);
  }
  return t;
}

const sideKey = (tags: Tags) => {
  const s = taggedSidewalks(tags);
  return s && s !== 'no' ? `sidewalk:${s}` : 'sidewalk:both';
};

/** Width of the sidewalks tagged on the road, metres, or null. */
export function sidewalkWidth(tags: Tags): number | null {
  for (const k of [`${sideKey(tags)}:width`, 'sidewalk:both:width', 'sidewalk:width', 'sidewalk:left:width', 'sidewalk:right:width']) {
    const v = Number.parseFloat((tags[k] ?? '').replace(',', '.'));
    if (Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

export const sidewalkSurface = (tags: Tags): string | null =>
  tags[`${sideKey(tags)}:surface`] ?? tags['sidewalk:both:surface'] ?? tags['sidewalk:surface'] ?? null;

export const withSidewalkWidth = (tags: Tags, metres: number | null): Tags =>
  withTag(tags, `${sideKey(tags)}:width`, metres ? String(Math.round(metres * 100) / 100) : null);

export const withSidewalkSurface = (tags: Tags, surface: string | null): Tags => withTag(tags, `${sideKey(tags)}:surface`, surface || null);
