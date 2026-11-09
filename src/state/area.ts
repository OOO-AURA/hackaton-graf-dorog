import { AreaError, bboxArea, defaultScope, downloadArea, geocode, LARGE_AREA_DEG2, type AreaScope, type Bbox } from '../osm/overpass';
import { hasRepairs } from '../osm/parse';
import { repairText } from './actions';
import { mapDataFetch } from '../platform';
import { isDirty, useEditor } from './store';

const KB = 1024;

const areaKm2 = ([s, w, n, e]: Bbox) => {
  const kmPerDegLat = 111.32;
  const kmPerDegLon = kmPerDegLat * Math.cos((((s + n) / 2) * Math.PI) / 180);
  return (n - s) * kmPerDegLat * (e - w) * kmPerDegLon;
};

/** File name for a downloaded area, e.g. "osm-52.2511_104.2566.osm". */
export const areaFileName = ([s, w]: Bbox) => `osm-${s.toFixed(4)}_${w.toFixed(4)}.osm`;

/** Asks before replacing unsaved edits or starting a heavy download. */
function confirmLoad(bbox: Bbox, scope: AreaScope): boolean {
  if (isDirty(useEditor.getState()) && !window.confirm('Несохранённые правки текущего графа пропадут. Загрузить новую область?')) return false;
  if (bboxArea(bbox) > LARGE_AREA_DEG2) {
    const what = scope === 'roads' ? 'Скачаю только дорожную сеть, без зданий.' : 'Со зданиями файл может выйти в сотни мегабайт.';
    return window.confirm(`Область около ${Math.round(areaKm2(bbox))} км², это уровень целого города. ${what} Загрузка займёт до нескольких минут. Продолжить?`);
  }
  return true;
}

/** Downloads the area from Overpass and opens it as a new graph. Returns false when cancelled or failed. */
export async function loadArea(bbox: Bbox, label: string, scope: AreaScope = defaultScope(bbox)): Promise<boolean> {
  const { load, notify } = useEditor.getState();
  if (!confirmLoad(bbox, scope)) return false;
  try {
    const started = performance.now();
    const { doc, repairs, xmlBytes } = await downloadArea(bbox, { scope, fetcher: mapDataFetch });
    const name = areaFileName(bbox);
    load(doc, name);
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    const summary = `${label}: ${Object.keys(doc.nodes).length} узлов, ${Object.keys(doc.ways).length} линий, ${Math.round(xmlBytes / KB)} КБ за ${seconds} с`;
    notify(hasRepairs(repairs) ? `${summary}. ${repairText(repairs)}` : summary);
    return true;
  } catch (err) {
    notify(err instanceof AreaError ? err.message : 'Не удалось загрузить область из OSM');
    console.error('Area download failed', err);
    return false;
  }
}

/** Finds a place by name and downloads its bounding box. */
export async function loadPlace(query: string, scope?: AreaScope): Promise<boolean> {
  try {
    const place = await geocode(query, mapDataFetch);
    return await loadArea(place.bbox, place.name.split(',')[0], scope ?? defaultScope(place.bbox));
  } catch (err) {
    useEditor.getState().notify(err instanceof AreaError ? err.message : 'Не удалось найти место');
    console.error('Geocoding failed', err);
    return false;
  }
}
