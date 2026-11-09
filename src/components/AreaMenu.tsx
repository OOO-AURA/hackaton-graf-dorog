import { useRef, useState } from 'react';
import { mapViewBbox } from '../map/instance';
import type { AreaScope, Bbox } from '../osm/overpass';
import { loadArea, loadPlace } from '../state/area';
import { withLoading } from './fileActions';

interface Preset { readonly label: string; readonly hint: string; readonly bbox: Bbox }

/** Ready areas that show the editor is not tied to the task fragment. */
const PRESETS: readonly Preset[] = [
  { label: 'Центр Иркутска', hint: 'Около 15 км² со зданиями, в 7 раз больше фрагмента из задания', bbox: [52.2700, 104.2550, 52.3000, 104.3200] },
  { label: 'Иркутск целиком', hint: '627 км², только дорожная сеть: около 100 тыс. узлов и 20 тыс. линий', bbox: [52.2179, 104.1366, 52.4069, 104.5747] },
  { label: 'Шелехов, другой город', hint: 'Город-спутник, 57 км², только дорожная сеть', bbox: [52.1756, 104.0362, 52.2564, 104.1291] },
];

/** Downloads any area or city straight from OpenStreetMap with the organisers' set of objects. */
export function AreaMenu({ align = 'right' }: { align?: 'left' | 'right' }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [query, setQuery] = useState('');
  const [noBuildings, setNoBuildings] = useState(false);
  const close = () => ref.current?.removeAttribute('open');
  /** Unticked means "decide by area size": buildings for a district, roads only for a city. */
  const scope: AreaScope | undefined = noBuildings ? 'roads' : undefined;

  const run = (label: string, task: () => Promise<boolean>) => { close(); void withLoading(`OSM: ${label}`, async () => { await task(); }); };
  const byView = () => {
    const bbox = mapViewBbox();
    if (bbox) run('видимая область', () => loadArea(bbox, 'Видимая область', scope));
  };

  return (
    <details className={`menu area-menu area-${align}`} ref={ref}>
      <summary className="btn btn-quiet" title="Скачать район или город из OpenStreetMap">Из OSM</summary>
      <div className="menu-list area-list" role="menu">
        <form className="area-search" onSubmit={(e) => { e.preventDefault(); if (query.trim()) run(query, () => loadPlace(query, scope)); }}>
          <label className="field">
            <span>Город или район</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ангарск, Шелехов, Усолье-Сибирское…" aria-label="Город или район" />
          </label>
          <button type="submit" className="btn btn-ink" disabled={!query.trim()}>Скачать</button>
        </form>
        <label className="area-scope">
          <input type="checkbox" checked={noBuildings} onChange={(e) => setNoBuildings(e.target.checked)} />
          <span>Без зданий. Для областей больше 40 км² включается само</span>
        </label>
        <button role="menuitem" onClick={byView}>
          <strong>Видимая область карты</strong><span>Тот же набор объектов, что в example.osm: дороги, трамвай, светофоры, переходы, остановки, здания</span>
        </button>
        {PRESETS.map((p) => (
          <button key={p.label} role="menuitem" onClick={() => run(p.label, () => loadArea(p.bbox, p.label, scope))}>
            <strong>{p.label}</strong><span>{p.hint}</span>
          </button>
        ))}
      </div>
    </details>
  );
}
