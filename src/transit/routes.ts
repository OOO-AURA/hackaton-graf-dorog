import type { OsmDoc, OsmRelation } from '../osm/types';

export const DEFAULT_INTERVAL_MIN = 10;
const MODES = new Set(['bus', 'trolleybus']);

export interface TransitRoute {
  id: string;
  ref: string;
  name: string;
  mode: string;
  color: string | null;
  /** Minutes between departures, from the relation's `interval` tag or the default. */
  interval: number;
  /** Way geometry as separate lines, in member order. */
  lines: Array<Array<[number, number]>>;
  /** Stop positions in travel order. */
  stops: Array<{ id: string; lonlat: [number, number]; name: string }>;
}

/** OSM `interval` is minutes ("10") or a duration ("00:10", "00:10:00"). */
export function parseInterval(value: string | undefined): number | null {
  if (!value) return null;
  const v = value.trim();
  if (/^\d+(\.\d+)?$/.test(v)) return Number(v) > 0 ? Number(v) : null;
  const parts = v.split(':').map(Number);
  if (parts.some((p) => !Number.isFinite(p))) return null;
  const [h, m = 0, s = 0] = parts;
  const minutes = h * 60 + m + s / 60;
  return minutes > 0 ? minutes : null;
}

const isStopRole = (role: string) => role === 'stop' || role.startsWith('stop_');
const isPlatformRole = (role: string) => role === 'platform' || role.startsWith('platform_');

function toRoute(doc: OsmDoc, r: OsmRelation): TransitRoute | null {
  const lines: TransitRoute['lines'] = [];
  for (const m of r.members) {
    if (m.type !== 'way' || isPlatformRole(m.role)) continue;
    const way = doc.ways[m.ref];
    if (!way?.tags.highway && !way?.tags.railway) continue;
    const coords = way.refs.map((id) => doc.nodes[id]).filter(Boolean).map((n) => [n.lon, n.lat] as [number, number]);
    if (coords.length > 1) lines.push(coords);
  }
  const pick = (test: (role: string) => boolean) => r.members
    .filter((m) => m.type === 'node' && test(m.role) && doc.nodes[m.ref])
    .map((m) => { const n = doc.nodes[m.ref]; return { id: n.id, lonlat: [n.lon, n.lat] as [number, number], name: n.tags.name ?? '' }; });
  let stops = pick(isStopRole);
  // Older PTv1 routes only list platforms.
  if (stops.length < 2) stops = pick(isPlatformRole);
  if (!lines.length) return null;
  return {
    id: r.id,
    ref: r.tags.ref ?? /(?:Автобус|Троллейбус|Маршрут)\s+№?\s*(\d+[а-яa-z]?)/i.exec(r.tags.name ?? '')?.[1] ?? '',
    name: r.tags.name ?? `Маршрут ${r.tags.ref ?? r.id}`,
    mode: r.tags.route,
    color: /^#[0-9a-f]{6}$/i.test(r.tags.colour ?? '') ? r.tags.colour : null,
    interval: parseInterval(r.tags.interval) ?? DEFAULT_INTERVAL_MIN,
    lines,
    stops,
  };
}

/** Bus and trolleybus routes of the fragment that still have road geometry. */
export function transitRoutes(doc: OsmDoc): TransitRoute[] {
  return Object.values(doc.relations)
    .filter((r) => r.tags.type === 'route' && MODES.has(r.tags.route))
    .map((r) => toRoute(doc, r))
    .filter((r): r is TransitRoute => r !== null)
    .sort((a, b) => a.ref.localeCompare(b.ref, 'ru', { numeric: true }) || a.name.localeCompare(b.name, 'ru'));
}

/** Sets the relation's interval tag; empty or invalid input removes it. */
export function setRouteInterval(doc: OsmDoc, id: string, minutes: number | null): OsmDoc {
  const r = doc.relations[id];
  if (!r) return doc;
  const tags = { ...r.tags };
  if (minutes && minutes > 0) tags.interval = String(Math.round(minutes));
  else delete tags.interval;
  return { ...doc, relations: { ...doc.relations, [id]: { ...r, tags } } };
}

export function transitGeoJson(routes: readonly TransitRoute[], selected: string | null): unknown {
  const features: unknown[] = [];
  for (const r of routes) {
    const on = r.id === selected;
    features.push({ type: 'Feature', properties: { kind: 'line', id: r.id, on, color: r.color ?? (r.mode === 'trolleybus' ? '#2F7FC1' : '#D9502B') }, geometry: { type: 'MultiLineString', coordinates: r.lines } });
    if (on || !selected) r.stops.forEach((s) => features.push({ type: 'Feature', properties: { kind: 'stop', id: r.id, on }, geometry: { type: 'Point', coordinates: s.lonlat } }));
  }
  return { type: 'FeatureCollection', features };
}

/** What the SUMO run needs: stops in order and the headway. */
export const transitDemand = (routes: readonly TransitRoute[]) => routes
  .filter((r) => r.stops.length >= 2)
  .map((r) => ({ id: r.id, name: r.ref || r.name, stops: r.stops.map((s) => s.lonlat), interval_min: r.interval }));
