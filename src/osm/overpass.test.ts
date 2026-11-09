import {
  AreaError, bboxArea, buildOverpassQuery, defaultScope, downloadArea, geocode, MAX_AREA_DEG2, OVERPASS_URL, validateBbox, type Bbox, type Fetcher,
} from './overpass';
import { SMALL_OSM } from '../test/docs';

const IRKUTSK_FRAGMENT: Bbox = [52.25113, 104.25656, 52.26942, 104.2677];

const respond = (body: string, status = 200): Fetcher => async () => new Response(body, { status });
/** No pauses between retry rounds in tests. */
const NOW = { retryDelaysMs: [0] } as const;

describe('buildOverpassQuery', () => {
  test('asks for the same object types as the organisers and closes ways with their nodes', () => {
    const q = buildOverpassQuery(IRKUTSK_FRAGMENT);
    expect(q).toContain('[bbox:52.251130,104.256560,52.269420,104.267700]');
    ['way["highway"]', 'way["building"]', 'traffic_signals', 'crossing', 'public_transport', 'tram'].forEach((part) => expect(q).toContain(part));
    expect(q).toContain('.base >;');
    expect(q).toContain('rel(bw.all)["route"');
    expect(q.trim().endsWith('out meta;')).toBe(true);
  });
});

describe('scope', () => {
  const IRKUTSK_CITY: Bbox = [52.2179, 104.1366, 52.4069, 104.5747];

  test('a fragment gets buildings, a whole city goes roads only', () => {
    expect(defaultScope(IRKUTSK_FRAGMENT)).toBe('full');
    expect(defaultScope(IRKUTSK_CITY)).toBe('roads');
    expect(() => validateBbox(IRKUTSK_CITY)).not.toThrow();
  });

  test('roads-only query keeps roads, signals and stops but not buildings', () => {
    const q = buildOverpassQuery(IRKUTSK_FRAGMENT, 'roads');
    expect(q).not.toContain('building');
    expect(q).toContain('way["highway"]');
    expect(q).toContain('traffic_signals');
  });
});

describe('validateBbox', () => {
  test('accepts a city fragment', () => {
    expect(() => validateBbox(IRKUTSK_FRAGMENT)).not.toThrow();
    expect(bboxArea(IRKUTSK_FRAGMENT)).toBeCloseTo(0.000204, 5);
  });

  test.each<[string, Bbox]>([
    ['empty', [52.3, 104.2, 52.2, 104.3]],
    ['not a number', [Number.NaN, 104.2, 52.3, 104.3]],
    ['out of range', [-95, 0, 10, 10]],
    ['too large', [50, 100, 50 + MAX_AREA_DEG2 + 1, 101]],
  ])('rejects %s box', (_, bbox) => {
    expect(() => validateBbox(bbox)).toThrow(AreaError);
  });
});

describe('downloadArea', () => {
  test('posts the query and returns the document with bounds set to the box', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const fetcher: Fetcher = async (url, init) => { calls.push([url, init]); return new Response(SMALL_OSM); };
    const { doc, repairs } = await downloadArea(IRKUTSK_FRAGMENT, { fetcher });
    expect(calls[0][0]).toBe(OVERPASS_URL);
    expect(calls[0][1]?.method).toBe('POST');
    expect(String(calls[0][1]?.body)).toContain(encodeURIComponent('way["highway"];'));
    expect(Object.keys(doc.ways)).toHaveLength(4);
    expect(doc.bounds).toEqual({ minlat: '52.251130', minlon: '104.256560', maxlat: '52.269420', maxlon: '104.267700' });
    expect(repairs).toEqual({ badNodes: 0, danglingRefs: 0, droppedWays: 0 });
  });

  test('explains server errors in plain words', async () => {
    await expect(downloadArea(IRKUTSK_FRAGMENT, { ...NOW, fetcher: respond('', 429) })).rejects.toThrow('перегружен');
    await expect(downloadArea(IRKUTSK_FRAGMENT, { ...NOW, fetcher: respond('', 504) })).rejects.toThrow('уменьшите область');
    await expect(downloadArea(IRKUTSK_FRAGMENT, { ...NOW, fetcher: respond('', 502) })).rejects.toThrow('перегружен');
    await expect(downloadArea(IRKUTSK_FRAGMENT, { ...NOW, fetcher: respond('', 500) })).rejects.toThrow('500');
    await expect(downloadArea(IRKUTSK_FRAGMENT, { ...NOW, fetcher: async () => { throw new Error('offline'); } })).rejects.toThrow('Нет связи');
  });

  test('falls back to a mirror when the main server is busy, but not on a bad request', async () => {
    const asked: string[] = [];
    const busyThenOk: Fetcher = async (url) => { asked.push(url); return asked.length === 1 ? new Response('', { status: 429 }) : new Response(SMALL_OSM); };
    await expect(downloadArea(IRKUTSK_FRAGMENT, { ...NOW, fetcher: busyThenOk, mirrors: ['a', 'b'] })).resolves.toBeDefined();
    expect(asked).toEqual(['a', 'b']);
    const badAsked: string[] = [];
    const bad: Fetcher = async (url) => { badAsked.push(url); return new Response('', { status: 400 }); };
    await expect(downloadArea(IRKUTSK_FRAGMENT, { ...NOW, fetcher: bad, mirrors: ['a', 'b'] })).rejects.toThrow('400');
    expect(badAsked).toEqual(['a']);
  });

  test('waits and goes over all mirrors again when every server is busy', async () => {
    vi.useFakeTimers();
    try {
      const asked: string[] = [];
      const fetcher: Fetcher = async (url) => { asked.push(url); return asked.length < 3 ? new Response('', { status: 502 }) : new Response(SMALL_OSM); };
      const pending = downloadArea(IRKUTSK_FRAGMENT, { fetcher, mirrors: ['a', 'b'], retryDelaysMs: [0, 5000] });
      await vi.advanceTimersByTimeAsync(5000);
      await expect(pending).resolves.toBeDefined();
      expect(asked).toEqual(['a', 'b', 'a']);
    } finally {
      vi.useRealTimers();
    }
  });

  test('reports an Overpass runtime error and an empty area', async () => {
    await expect(downloadArea(IRKUTSK_FRAGMENT, { ...NOW, fetcher: respond('<osm version="0.6"><remark> runtime error: Query timed out </remark></osm>') }))
      .rejects.toThrow('прервал');
    await expect(downloadArea(IRKUTSK_FRAGMENT, { ...NOW, fetcher: respond('<osm version="0.6"/>') })).rejects.toThrow('нет дорог');
  });
});

describe('geocode', () => {
  test('turns a Nominatim bounding box into south-west-north-east order', async () => {
    let asked = '';
    const fetcher: Fetcher = async (url) => {
      asked = url;
      return new Response(JSON.stringify([{ display_name: 'Ангарск, Иркутская область', boundingbox: ['52.47', '52.60', '103.75', '104.02'] }]));
    };
    const place = await geocode('Ангарск', fetcher);
    expect(asked).toContain(`q=${encodeURIComponent('Ангарск')}`);
    expect(place).toEqual({ name: 'Ангарск, Иркутская область', bbox: [52.47, 103.75, 52.6, 104.02] });
  });

  test('fails clearly for empty queries and unknown places', async () => {
    await expect(geocode('  ', respond('[]'))).rejects.toThrow('Введите');
    await expect(geocode('Нигдебург', respond('[]'))).rejects.toThrow('не найдено');
  });
});
