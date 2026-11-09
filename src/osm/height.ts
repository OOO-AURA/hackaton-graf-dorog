import { withTag } from './tags';
import type { Tags } from './types';

/**
 * Heights in standard OSM tags only, so MATSim, SUMO and Webots read the file as before:
 * buildings use `height`, `building:levels` and `min_height`; roads use `layer` together with
 * `bridge` or `tunnel`; nodes use `ele`.
 */

/** Storey height used to turn levels into metres and back. */
export const LEVEL_HEIGHT = 3;
/** Height of one `layer` step of a bridge in the 3D view. */
export const LAYER_STEP = 5;
export const MAX_BUILDING_HEIGHT = 300;
export const MIN_LAYER = -5;
export const MAX_LAYER = 5;

const num = (v: string | undefined) => {
  const n = Number.parseFloat(v ?? '');
  return Number.isFinite(n) ? n : null;
};

/** Metres with at most one decimal, without trailing zeros. */
export const formatMetres = (m: number) => String(Math.round(m * 10) / 10);

export interface BuildingHeight {
  /** Top of the building, metres above ground. */
  height: number;
  levels: number;
  /** Bottom of the building, metres above ground; 0 when it stands on the ground. */
  minHeight: number;
  /** Whether the height is written in the file or guessed. */
  known: boolean;
}

/** Height as the 3D view draws it: `height`, else levels × 3 m, else 9 m. */
export function buildingHeight(tags: Tags): BuildingHeight {
  const h = num(tags.height);
  const levels = num(tags['building:levels']);
  const minHeight = Math.max(0, num(tags.min_height) ?? 0);
  if (h !== null && h > 0) return { height: h, levels: levels ?? Math.max(1, Math.round((h - minHeight) / LEVEL_HEIGHT)), minHeight, known: true };
  if (levels !== null && levels > 0) return { height: minHeight + levels * LEVEL_HEIGHT, levels, minHeight, known: true };
  return { height: 9, levels: 3, minHeight, known: false };
}

/** Sets the top of a building in metres; levels follow so both tags agree. */
export function withBuildingHeight(tags: Tags, metres: number): Tags {
  const { minHeight } = buildingHeight(tags);
  const h = Math.min(MAX_BUILDING_HEIGHT, Math.max(minHeight + 1, metres));
  const levels = Math.max(1, Math.round((h - minHeight) / LEVEL_HEIGHT));
  return withTag(withTag(tags, 'height', formatMetres(h)), 'building:levels', String(levels));
}

/** Sets the number of storeys; the height follows. */
export function withBuildingLevels(tags: Tags, levels: number): Tags {
  const { minHeight } = buildingHeight(tags);
  const n = Math.max(1, Math.round(levels));
  return withTag(withTag(tags, 'building:levels', String(n)), 'height', formatMetres(Math.min(MAX_BUILDING_HEIGHT, minHeight + n * LEVEL_HEIGHT)));
}

/** Sets the bottom of a building (an arch, a canopy); 0 removes the tag. The top stays put. */
export function withMinHeight(tags: Tags, metres: number): Tags {
  const { height } = buildingHeight(tags);
  const m = Math.max(0, Math.min(height - 1, metres));
  const next = withTag(tags, 'min_height', m > 0 ? formatMetres(m) : null);
  return withBuildingHeight(withTag(next, 'height', formatMetres(height)), height);
}

export type RoadLevelKind = 'ground' | 'bridge' | 'tunnel';

const yes = (v: string | undefined) => Boolean(v && v !== 'no');

/** Where a road runs: its OSM layer, and whether it is a bridge or a tunnel. */
export function roadLevel(tags: Tags): { kind: RoadLevelKind; layer: number } {
  const layer = Math.round(num(tags.layer) ?? 0);
  if (yes(tags.bridge)) return { kind: 'bridge', layer: layer > 0 ? layer : 1 };
  if (yes(tags.tunnel)) return { kind: 'tunnel', layer: layer < 0 ? layer : -1 };
  return { kind: 'ground', layer };
}

/**
 * Puts a road on a level: above 0 it becomes a bridge, below 0 a tunnel, at 0 a road on the
 * ground. A bridge or tunnel value already set (`viaduct`, `building_passage`) is kept.
 */
export function withRoadLayer(tags: Tags, layer: number): Tags {
  const l = Math.max(MIN_LAYER, Math.min(MAX_LAYER, Math.round(layer)));
  const was = roadLevel(tags).kind;
  let next = withTag(tags, 'layer', l === 0 ? null : String(l));
  if (l > 0) {
    next = withTag(next, 'tunnel', null);
    if (was !== 'bridge') next = withTag(next, 'bridge', 'yes');
  } else if (l < 0) {
    next = withTag(next, 'bridge', null);
    if (was !== 'tunnel') next = withTag(next, 'tunnel', 'yes');
  } else {
    next = withTag(withTag(next, 'bridge', null), 'tunnel', null);
  }
  return next;
}

/** Switches a road between ground, bridge and tunnel at the nearest level of that kind. */
export function withRoadKind(tags: Tags, kind: RoadLevelKind): Tags {
  const { layer } = roadLevel(tags);
  if (kind === 'bridge') return withRoadLayer(tags, layer > 0 ? layer : 1);
  if (kind === 'tunnel') return withRoadLayer(tags, layer < 0 ? layer : -1);
  return withRoadLayer(tags, 0);
}

/** Height of a node above sea level (`ele`), or null. */
export const nodeElevation = (tags: Tags) => num(tags.ele);

export const withElevation = (tags: Tags, metres: number | null) =>
  withTag(tags, 'ele', metres === null || !Number.isFinite(metres) ? null : formatMetres(metres));
