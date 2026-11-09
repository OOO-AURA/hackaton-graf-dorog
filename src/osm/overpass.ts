/**
 * Downloading any area or city from OpenStreetMap through Overpass API.
 *
 * The query takes the same set of objects the organisers used for example.osm: roads, tram
 * tracks, signals, crossings, stops, buildings and route relations. So a fragment of another
 * district or a whole city goes through the editor and the MatSim/SUMO/Webots pipeline the same way.
 */
import { parseOsmChecked, type OsmRepairs } from './parse';
import type { OsmDoc } from './types';

/** [south, west, north, east] in degrees, the order Overpass expects. */
export type Bbox = readonly [number, number, number, number];

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
/** Public mirrors tried in turn when the main server is busy or unreachable. */
export const OVERPASS_MIRRORS = [
  OVERPASS_URL,
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
] as const;
export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

/**
 * Above this area (deg², about 40 km² at Irkutsk latitude) buildings make the file too heavy:
 * the task fragment is 2 km² and 1.8 MB, so a whole city with buildings would be hundreds of MB.
 */
export const LARGE_AREA_DEG2 = 0.005;
/** Hard stop well above a big city (Irkutsk is about 0.08 deg²); public Overpass servers refuse more. */
export const MAX_AREA_DEG2 = 0.2;

/** 'full' is the organisers' set of objects; 'roads' drops buildings for city-wide graphs. */
export type AreaScope = 'full' | 'roads';

/** Default scope for an area: whole-city boxes go without buildings. */
export const defaultScope = (bbox: Bbox): AreaScope => (bboxArea(bbox) > LARGE_AREA_DEG2 ? 'roads' : 'full');
const OVERPASS_TIMEOUT_S = 300;

export class AreaError extends Error {}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export const bboxArea = ([s, w, n, e]: Bbox): number => Math.max(0, n - s) * Math.max(0, e - w);

export function validateBbox(bbox: Bbox): void {
  const [s, w, n, e] = bbox;
  if (![s, w, n, e].every(Number.isFinite)) throw new AreaError('Границы области заданы неверно');
  if (s >= n || w >= e) throw new AreaError('Пустая область: юг должен быть меньше севера, запад меньше востока');
  if (s < -90 || n > 90 || w < -180 || e > 180) throw new AreaError('Границы области вне диапазона координат');
  if (bboxArea(bbox) > MAX_AREA_DEG2) throw new AreaError('Область слишком большая для Overpass: выберите город или его часть');
}

const fmt = (v: number) => v.toFixed(6);

/** Overpass QL: objects in the box, every node of those ways (so nothing dangles), and the routes using them. */
export function buildOverpassQuery(bbox: Bbox, scope: AreaScope = 'full'): string {
  const box = bbox.map(fmt).join(',');
  const buildings = scope === 'full' ? ['  way["building"];', '  way["building:part"];'] : [];
  return [
    `[out:xml][timeout:${OVERPASS_TIMEOUT_S}][bbox:${box}];`,
    '(',
    '  way["highway"];',
    '  way["railway"~"^(tram|light_rail|rail)$"];',
    ...buildings,
    '  node["highway"~"^(traffic_signals|crossing|bus_stop|stop|give_way)$"];',
    '  node["public_transport"];',
    '  node["railway"~"^(tram_stop|level_crossing)$"];',
    '  node["traffic_calming"];',
    ')->.base;',
    '(.base; .base >;)->.all;',
    'rel(bw.all)["route"~"^(bus|tram|trolleybus|share_taxi)$"]->.routes;',
    '(.all; .routes;);',
    'out meta;',
  ].join('\n');
}

/** Overpass does not write <bounds> for a bbox query; the editor needs it for cordon detection. */
export function withBounds(doc: OsmDoc, [s, w, n, e]: Bbox): OsmDoc {
  return { ...doc, bounds: { minlat: fmt(s), minlon: fmt(w), maxlat: fmt(n), maxlon: fmt(e) } };
}

async function readOk(res: Response, what: string): Promise<string> {
  if (res.status === 429 || res.status === 502 || res.status === 503) throw new AreaError(`${what}: сервер перегружен, повторите через минуту`);
  if (res.status === 504) throw new AreaError(`${what}: сервер не успел ответить, повторите позже или уменьшите область`);
  if (!res.ok) throw new AreaError(`${what}: ошибка сервера ${res.status}`);
  return res.text();
}

export interface AreaResult {
  readonly doc: OsmDoc;
  readonly repairs: OsmRepairs;
  readonly xmlBytes: number;
}

/** A mirror is worth trying after these: busy, overloaded, refusing the client, or down. */
const isRetryable = (status: number) => status === 406 || status === 429 || status >= 500;

/** Pause before each round over all mirrors; the main server asks clients to back off when busy. */
export const RETRY_DELAYS_MS: readonly number[] = [0, 10_000, 30_000];

const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

async function queryOverpass(bbox: Bbox, scope: AreaScope, fetcher: Fetcher, mirrors: readonly string[], delays: readonly number[]): Promise<string> {
  const body = `data=${encodeURIComponent(buildOverpassQuery(bbox, scope))}`;
  let lastError: AreaError = new AreaError('Нет связи с Overpass API');
  const attempts = delays.flatMap((delay) => mirrors.map((url, i) => ({ url, delay: i === 0 ? delay : 0 })));
  for (const { url, delay } of attempts) {
    if (delay > 0) await sleep(delay);
    try {
      const res = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      if (res.ok || !isRetryable(res.status)) return await readOk(res, 'Overpass');
      lastError = new AreaError(await readOk(res, 'Overpass').catch((e: Error) => e.message));
    } catch (err) {
      if (err instanceof AreaError) throw err;
      lastError = new AreaError(`Нет связи с Overpass API: ${err instanceof Error ? err.message : String(err)}`);
    }
    console.warn(`Overpass mirror failed: ${url}`, lastError.message);
  }
  throw lastError;
}

export interface DownloadOptions {
  readonly scope?: AreaScope;
  readonly fetcher?: Fetcher;
  readonly mirrors?: readonly string[];
  /** Pauses before each round over the mirrors, see RETRY_DELAYS_MS. */
  readonly retryDelaysMs?: readonly number[];
}

export async function downloadArea(bbox: Bbox, options: DownloadOptions = {}): Promise<AreaResult> {
  const { scope = defaultScope(bbox), fetcher = fetch, mirrors = OVERPASS_MIRRORS, retryDelaysMs = RETRY_DELAYS_MS } = options;
  validateBbox(bbox);
  const xml = await queryOverpass(bbox, scope, fetcher, mirrors, retryDelaysMs);
  if (/<remark>\s*runtime error/i.test(xml)) throw new AreaError('Overpass прервал запрос: область слишком большая или сервер занят');
  const { doc, repairs } = parseOsmChecked(xml);
  if (!Object.keys(doc.ways).length) throw new AreaError('В этой области нет дорог и зданий');
  return { doc: withBounds(doc, bbox), repairs, xmlBytes: xml.length };
}

export interface Place {
  readonly name: string;
  readonly bbox: Bbox;
}

/** Finds a city or district by name; Nominatim gives its bounding box. */
export async function geocode(query: string, fetcher: Fetcher = fetch): Promise<Place> {
  const q = query.trim();
  if (!q) throw new AreaError('Введите название города или района');
  const url = `${NOMINATIM_URL}?format=jsonv2&limit=1&accept-language=ru&q=${encodeURIComponent(q)}`;
  let res: Response;
  try {
    res = await fetcher(url, { headers: { Accept: 'application/json' } });
  } catch (err) {
    throw new AreaError(`Нет связи с Nominatim: ${err instanceof Error ? err.message : String(err)}`);
  }
  const hits = JSON.parse(await readOk(res, 'Поиск места')) as Array<{ display_name?: string; boundingbox?: string[] }>;
  const hit = hits[0];
  const box = hit?.boundingbox?.map(Number);
  if (!hit || !box || box.length !== 4 || !box.every(Number.isFinite)) throw new AreaError(`Место «${q}» не найдено`);
  const [s, n, w, e] = box;
  return { name: hit.display_name ?? q, bbox: [s, w, n, e] };
}
