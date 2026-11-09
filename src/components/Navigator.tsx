import { useMemo, useState } from 'react';
import { isDrivable, ROAD_TEMPLATES } from '../osm/tags';
import type { OsmDoc } from '../osm/types';
import { useEditor } from '../state/store';
import { useUi } from '../state/ui';
import { MAP_PALETTE, ROAD_CLASSES } from '../map/palette';
import { Icon } from './icons';
import { TOOLS } from './tools';

interface Street { name: string; wayIds: string[]; bounds: [number, number, number, number] }

function streetsOf(doc: OsmDoc): Street[] {
  const byName = new Map<string, Street>();
  Object.values(doc.ways).forEach((w) => {
    const name = w.tags.name;
    if (!name || !isDrivable(w.tags)) return;
    const s = byName.get(name) ?? { name, wayIds: [], bounds: [Infinity, Infinity, -Infinity, -Infinity] };
    s.wayIds.push(w.id);
    w.refs.forEach((r) => {
      const n = doc.nodes[r];
      if (!n) return;
      s.bounds = [Math.min(s.bounds[0], n.lon), Math.min(s.bounds[1], n.lat), Math.max(s.bounds[2], n.lon), Math.max(s.bounds[3], n.lat)];
    });
    byName.set(name, s);
  });
  return [...byName.values()].filter((s) => Number.isFinite(s.bounds[0])).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

function Tools() {
  const mode = useEditor((s) => s.mode);
  const setMode = useEditor((s) => s.setMode);
  const template = useEditor((s) => s.templateIndex);
  const setTemplate = useEditor((s) => s.setTemplate);
  const hint = TOOLS.find((t) => t.mode === mode)?.hint;
  return (
    <section className="nav-section">
      <h2 className="micro">Инструменты</h2>
      <div className="tool-grid">
        {TOOLS.map((t) => (
          <button key={t.mode} className={`tool-tile${mode === t.mode ? ' on' : ''}`} onClick={() => setMode(t.mode)} aria-pressed={mode === t.mode}>
            <Icon name={t.icon} size={18} /><span>{t.label}</span><kbd>{t.key}</kbd>
          </button>
        ))}
      </div>
      <p className="hint">{hint}</p>
      <h2 className="micro">Шаблоны дорог</h2>
      <ul className="templates">
        {ROAD_TEMPLATES.map((t, i) => (
          <li key={t.label}>
            <button className={template === i ? 'on' : ''} onClick={() => { setTemplate(i); setMode('draw'); }}>
              <kbd>{i + 1}</kbd><span>{t.label}</span>
              <span className="mono tpl-tags">{t.tags.lanes ? `${t.tags.lanes} пол.` : ''}{t.tags.oneway === 'yes' ? ' →' : ''}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Objects() {
  const doc = useEditor((s) => s.doc);
  const select = useEditor((s) => s.select);
  const flyTo = useUi((s) => s.flyTo);
  const [query, setQuery] = useState('');
  const streets = useMemo(() => streetsOf(doc), [doc]);
  const q = query.trim().toLowerCase();
  const found = q ? streets.filter((s) => s.name.toLowerCase().includes(q)) : streets;
  const open = (s: Street) => {
    flyTo(s.bounds);
    select({ type: 'way', id: s.wayIds[0] });
  };
  return (
    <section className="nav-section nav-objects">
      <h2 className="micro">Улицы <span className="count mono">{streets.length}</span></h2>
      <label className="search">
        <Icon name="search" />
        <input type="search" placeholder="Поиск по названию" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Поиск улицы" />
      </label>
      <ul className="street-list">
        {found.map((s) => (
          <li key={s.name}><button onClick={() => open(s)}><span>{s.name}</span><span className="mono count">{s.wayIds.length}</span></button></li>
        ))}
        {!found.length && <li className="hint">Ничего не нашлось</li>}
      </ul>
    </section>
  );
}

function Legend() {
  const theme = useUi((s) => s.theme);
  const p = MAP_PALETTE[theme];
  return (
    <section className="nav-section">
      <h2 className="micro">Легенда</h2>
      <ul className="legend">
        {ROAD_CLASSES.map((c) => <li key={c.id}><i className="swatch-line" style={{ background: p.roads[c.id] }} />{c.label}</li>)}
        <li><i className="swatch-dot" style={{ background: p.signal }} />Светофор</li>
        <li><i className="swatch-ring" style={{ borderColor: p.error }} />Ошибка графа</li>
        <li><i className="swatch-ring" style={{ borderColor: p.warning }} />Замечание</li>
        <li><i className="swatch-ring" style={{ borderColor: p.cordon }} />Граница фрагмента</li>
      </ul>
    </section>
  );
}

export function Navigator() {
  return (
    <aside className="panel navigator" aria-label="Навигатор">
      <Tools />
      <Objects />
      <Legend />
    </aside>
  );
}
