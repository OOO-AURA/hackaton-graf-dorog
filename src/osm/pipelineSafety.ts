/**
 * Tag values that make the Webots OSM importer stop with an exception, so the jury pipeline gives
 * no 3D video and the file fails the admission check. Found in osm_importer (R2025a):
 * - road `lanes` goes through int() and `assert lanes > 0` outside any try (road.py);
 * - `layer` of every way goes through float() before anything else (parser_objects.py);
 * - `building:colour` / `roof:colour` starting with '#' go through int(..., 16);
 * - a building with `min_height` divides by its height, which is `height − roof:height`.
 * Each check comes with a safe value, so the fix keeps as much of the intent as possible.
 */
import type { OsmDoc, OsmWay, Tags } from './types';

export interface UnsafeTag {
  readonly wayId: string;
  readonly key: string;
  readonly value: string;
  readonly reason: string;
  /** Value that keeps Webots working, or null to drop the tag. */
  readonly safe: string | null;
}

const INTEGER = /^\d+$/;
const NUMBER = /^[-+]?\d+(\.\d+)?$/;
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** First whole number of a value like "2.5", "2;3" or "3 lanes", at least 1; null when there is none. */
export function positiveInteger(value: string): string | null {
  const m = value.match(/\d+(\.\d+)?/);
  if (!m) return null;
  const n = Math.round(Number(m[0]));
  return n >= 1 ? String(n) : null;
}

function layerValue(value: string): string | null {
  const m = value.match(/[-+]?\d+/);
  return m ? String(Number(m[0])) : null;
}

const num = (v: string | undefined) => {
  const m = (v ?? '').match(/[-+]?\d*\.?\d+/);
  return m ? Number(m[0]) : null;
};

function wayProblems(w: OsmWay): UnsafeTag[] {
  const t = w.tags;
  const out: UnsafeTag[] = [];
  const add = (key: string, reason: string, safe: string | null) => out.push({ wayId: w.id, key, value: t[key], reason, safe });
  if (t.layer !== undefined && !NUMBER.test(t.layer.trim())) add('layer', 'layer должен быть числом', layerValue(t.layer));
  if (t.highway) {
    ['lanes', 'lanes:forward', 'lanes:backward'].forEach((key) => {
      if (t[key] !== undefined && !(INTEGER.test(t[key]) && Number(t[key]) >= 1)) add(key, `${key} должно быть целым числом от 1`, positiveInteger(t[key]));
    });
  }
  if (t.building || t['building:part']) {
    ['building:colour', 'roof:colour'].forEach((key) => {
      if (t[key]?.startsWith('#') && !HEX.test(t[key])) add(key, 'цвет вида #rrggbb', null);
    });
    const height = num(t.height);
    const roof = num(t['roof:height']) ?? 0;
    if (height !== null && t['roof:height'] !== undefined && roof >= height) add('roof:height', 'крыша не может быть выше всего здания', null);
    // As the importer computes it: the body is the height minus the roof whenever a roof height is given.
    const body = height === null ? null : height - (roof > 0 ? roof : 0);
    if (t.min_height !== undefined && body !== null && (body <= 0 || (num(t.min_height) ?? 0) >= body)) add('min_height', 'низ здания должен быть ниже его верха', null);
  }
  return out;
}

export function unsafeTags(doc: OsmDoc): UnsafeTag[] {
  return Object.values(doc.ways).flatMap(wayProblems);
}

const MAX_FIX_ROUNDS = 8;

/**
 * Fixes one problem at a time and checks again, so a fix that removes the cause of another
 * problem (a roof higher than the building makes min_height invalid) does not drop more than needed.
 */
export function sanitizeWay(way: OsmWay): Tags {
  let tags = way.tags;
  for (let round = 0; round < MAX_FIX_ROUNDS; round += 1) {
    const [p] = wayProblems({ ...way, tags });
    if (!p) break;
    const { [p.key]: _old, ...rest } = tags;
    tags = p.safe === null ? rest : { ...rest, [p.key]: p.safe };
  }
  return tags;
}

export function sanitizeDoc(doc: OsmDoc, wayIds?: readonly string[]): OsmDoc {
  const only = wayIds ? new Set(wayIds) : null;
  const ids = [...new Set(unsafeTags(doc).map((p) => p.wayId))].filter((id) => !only || only.has(id));
  if (!ids.length) return doc;
  const ways = Object.fromEntries(ids.map((id) => [id, { ...doc.ways[id], tags: sanitizeWay(doc.ways[id]) }]));
  return { ...doc, ways: { ...doc.ways, ...ways } };
}

/** Input guard for the inspector: the value to store for a typed lane count or layer, or null to clear. */
export function safeInput(key: string, value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (key === 'lanes' || key === 'lanes:forward' || key === 'lanes:backward') return positiveInteger(v);
  if (key === 'layer') return layerValue(v);
  return v;
}
