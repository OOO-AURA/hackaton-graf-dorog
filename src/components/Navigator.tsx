import { useMemo, useState } from 'react';
import { isDrivable } from '../osm/tags';
import type { OsmDoc } from '../osm/types';
import { useEditor } from '../state/store';
import { useUi } from '../state/ui';
import { MAP_PALETTE, ROAD_CLASSES } from '../map/palette';
import { Icon } from './icons';
import { VirtualList } from './VirtualList';
import { Why } from './Why';
import { NODE_FEATURES, hasFeature } from '../map/features';
import { signUrl } from '../map/signArt';
import { junctions } from '../osm/lanes';
import { ViewSettings } from './ViewSettings';
import { useSettledDoc } from '../state/settled';
import { isParkingArea, parkingInfo, parkingKind, PARKING_KINDS } from '../osm/parking';

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

interface Junction { id: string; name: string; lon: number; lat: number }

function junctionsOf(doc: OsmDoc): Junction[] {
  const names = new Map<string, Set<string>>();
  Object.values(doc.ways).forEach((w) => {
    if (!isDrivable(w.tags)) return;
    w.refs.forEach((r) => { const set = names.get(r) ?? new Set<string>(); if (w.tags.name) set.add(w.tags.name); names.set(r, set); });
  });
  return junctions(doc).map((id) => {
    const n = doc.nodes[id];
    const list = [...(names.get(id) ?? [])];
    return { id, name: list.length ? list.slice(0, 2).join(' × ') : `Узел ${id}`, lon: n.lon, lat: n.lat };
  }).sort((x, y) => x.name.localeCompare(y.name, 'ru'));
}

interface Control { id: string; kind: string; lon: number; lat: number }

function controlsOf(doc: OsmDoc): Control[] {
  const out: Control[] = [];
  Object.values(doc.nodes).forEach((n) => {
    const f = NODE_FEATURES.find((x) => hasFeature(n.tags, x));
    if (f) out.push({ id: n.id, kind: f.id, lon: n.lon, lat: n.lat });
  });
  return out;
}

interface ParkingLot { id: string; name: string; places: number | null; bounds: [number, number, number, number] }

/** Car parks drawn as areas, named or by their kind, the largest first. */
function parkingsOf(doc: OsmDoc): ParkingLot[] {
  return Object.values(doc.ways).filter(isParkingArea).map((w) => {
    const pts = w.refs.map((r) => doc.nodes[r]).filter(Boolean);
    const bounds: [number, number, number, number] = [Math.min(...pts.map((n) => n.lon)), Math.min(...pts.map((n) => n.lat)), Math.max(...pts.map((n) => n.lon)), Math.max(...pts.map((n) => n.lat))];
    const info = parkingInfo(doc, w.id);
    const kind = PARKING_KINDS.find(([v]) => v === parkingKind(w.tags))?.[1] ?? 'Парковка';
    return { id: w.id, name: w.tags.name || kind, places: info ? info.capacity ?? info.estimate : null, bounds };
  }).sort((a, b) => (b.places ?? 0) - (a.places ?? 0));
}

const around = (lon: number, lat: number, d = 0.0012): [number, number, number, number] => [lon - d, lat - d * 0.6, lon + d, lat + d * 0.6];

function Group({ title, count, open, onToggle, children }: { title: string; count: number; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className={`nav-group${open ? ' open' : ''}`}>
      <button className="nav-group-head" onClick={onToggle} aria-expanded={open}>
        <Icon name="chevron" size={12} style={{ transform: open ? 'none' : 'rotate(-90deg)' }} />
        <span>{title}</span><span className="mono count">{count}</span>
      </button>
      {open && <div className="nav-group-body">{children}</div>}
    </div>
  );
}

function Objects() {
  const doc = useSettledDoc();
  const select = useEditor((s) => s.select);
  const flyTo = useUi((s) => s.flyTo);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({ roads: true, junctions: false, controls: false });
  const streets = useMemo(() => streetsOf(doc), [doc]);
  const juncs = useMemo(() => junctionsOf(doc), [doc]);
  const controls = useMemo(() => controlsOf(doc), [doc]);
  const parkings = useMemo(() => parkingsOf(doc), [doc]);
  const q = query.trim().toLowerCase();
  const fStreets = q ? streets.filter((s) => s.name.toLowerCase().includes(q)) : streets;
  const fJuncs = q ? juncs.filter((j) => j.name.toLowerCase().includes(q)) : juncs;
  const fParkings = q ? parkings.filter((p) => p.name.toLowerCase().includes(q) || 'парковка'.includes(q)) : parkings;
  const byKind = NODE_FEATURES.map((f) => ({ f, items: controls.filter((c) => c.kind === f.id) })).filter((g) => g.items.length && (!q || g.f.label.toLowerCase().includes(q)));
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const openStreet = (s: Street) => { flyTo(s.bounds); select(s.wayIds.length > 1 ? { type: 'street', id: s.name } : { type: 'way', id: s.wayIds[0] }); };
  const openNode = (id: string, lon: number, lat: number) => { flyTo(around(lon, lat)); select({ type: 'node', id }); };
  return (
    <div className="nav-objects">
      <label className="search">
        <Icon name="search" />
        <input type="search" placeholder="Улица, перекрёсток, знак" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Поиск по объектам" />
      </label>
      <Group title="Дороги" count={fStreets.length} open={open.roads || Boolean(q)} onToggle={() => toggle('roads')}>
        {fStreets.length
          ? <VirtualList className="street-list" items={fStreets} rowHeight={25} keyOf={(s) => s.name}
              render={(s) => <button onClick={() => openStreet(s)}><span>{s.name}</span><span className="mono count">{s.wayIds.length}</span></button>} />
          : <p className="hint">Ничего не нашлось</p>}
      </Group>
      <Group title="Перекрёстки" count={fJuncs.length} open={open.junctions} onToggle={() => toggle('junctions')}>
        <VirtualList className="street-list" items={fJuncs} rowHeight={25} keyOf={(j) => j.id}
          render={(j) => <button onClick={() => openNode(j.id, j.lon, j.lat)}><span>{j.name}</span></button>} />
      </Group>
      <Group title="Парковки" count={fParkings.length} open={open.parking || (Boolean(q) && fParkings.length > 0)} onToggle={() => toggle('parking')}>
        {fParkings.length
          ? <VirtualList className="street-list" items={fParkings} rowHeight={25} keyOf={(p) => p.id}
              render={(p) => <button onClick={() => { flyTo(p.bounds); select({ type: 'way', id: p.id }); }}><span>{p.name}</span>{p.places !== null && <span className="mono count">{p.places} м.</span>}</button>} />
          : <p className="hint">Парковок нет. Поставить: инструмент «Парковка», клавиша K</p>}
      </Group>
      <Group title="ТСОДД" count={controls.length} open={open.controls} onToggle={() => toggle('controls')}>
        <ul className="control-list">
          {byKind.map(({ f, items }) => (
            <li key={f.id}>
              <button onClick={() => openNode(items[0].id, items[0].lon, items[0].lat)} title="Показать первый на карте">
                <img src={signUrl(f.id)} alt="" width={18} height={18} /><span>{f.label}</span><span className="mono count">{items.length}</span>
              </button>
            </li>
          ))}
        </ul>
      </Group>
    </div>
  );
}

function Legend() {
  const theme = useUi((s) => s.theme);
  const p = MAP_PALETTE[theme];
  return (
    <section className="nav-section">
      <ul className="legend">
        {ROAD_CLASSES.map((c) => <li key={c.id}><i className="swatch-line" style={{ background: p.roads[c.id] }} />{c.label}</li>)}
        <li><img className="legend-sign" src={signUrl('signal')} alt="" />Светофор</li>
        <li><img className="legend-sign" src={signUrl('crossing')} alt="" />Переход</li>
        <li><img className="legend-sign" src={signUrl('bump')} alt="" />Лежачий полицейский</li>
        <li><img className="legend-sign" src={signUrl('parking')} alt="" />Парковка</li>
        <li><i className="swatch-ring" style={{ borderColor: p.error }} />Ошибка графа, запрет поворота</li>
        <li><i className="swatch-ring" style={{ borderColor: p.warning }} />Замечание</li>
        <li><i className="swatch-ring" style={{ borderColor: p.cordon }} />Граница фрагмента</li>
      </ul>
    </section>
  );
}

const TABS = [['objects', 'Объекты'], ['view', 'Вид карты'], ['legend', 'Легенда']] as const;

export function Navigator() {
  const tab = useUi((s) => s.navTab);
  const setTab = useUi((s) => s.setNavTab);
  return (
    <aside className="panel navigator" aria-label="Навигатор">
      <div className="nav-head"><h2 className="micro">Навигатор</h2><Why id="navigator" /></div>
      <div className="panel-tabs" role="tablist">
        {TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      <div className="nav-tab-body">
        {tab === 'objects' && <Objects />}
        {tab === 'view' && <ViewSettings />}
        {tab === 'legend' && <Legend />}
      </div>
    </aside>
  );
}
