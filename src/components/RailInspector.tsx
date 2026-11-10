import { setNodeTags, setWayTag, setWayTags } from '../osm/edit';
import type { OsmNode, OsmWay } from '../osm/types';
import {
  ELECTRIFIED, isPlatform, isRailLine, RAIL_SERVICES, RAIL_TYPES, RAIL_USAGES, STATION_TYPES, stationKind, type StationKind,
} from '../osm/rail';
import { withTag } from '../osm/tags';
import { useEditor } from '../state/store';
import { deleteSelection } from '../state/actions';
import { SelectField, TextField } from './fields';
import { RoadLevelFields } from './HeightFields';
import { Section } from './Section';
import { TagTable } from './TagTable';
import { Icon } from './icons';

const kindLabel = (tags: OsmWay['tags']) =>
  isRailLine(tags) ? RAIL_TYPES.find(([v]) => v === tags.railway)?.[1] ?? 'Путь' : 'Платформа';

/** A railway track or platform: type, purpose, power and gauge, its level and all its tags. */
export function RailInspector({ way }: { way: OsmWay }) {
  const apply = useEditor((s) => s.apply);
  const t = way.tags;
  const set = (key: string) => (value: string) => apply((d) => setWayTag(d, way.id, key, value || null));
  const track = isRailLine(t);
  return (
    <div className="inspector">
      <header className="insp-head">
        <span className="micro">{track ? 'Путь' : 'Платформа'}</span>
        <h2 className="insp-title">{t.name || kindLabel(t)}</h2>
        <span className="mono insp-id">way {way.id} · {way.refs.length} узл.</span>
      </header>
      {track ? (
        <Section title="Путь">
          <SelectField label="Тип" value={t.railway ?? ''} options={RAIL_TYPES} onChange={set('railway')} />
          <div className="row">
            <SelectField label="Назначение" value={t.service ?? ''} options={RAIL_SERVICES} onChange={set('service')} />
            {t.railway === 'rail' && <SelectField label="Линия" value={t.usage ?? ''} options={RAIL_USAGES} onChange={set('usage')} />}
          </div>
          <div className="row">
            <SelectField label="Электрификация" value={t.electrified ?? ''} options={ELECTRIFIED} onChange={set('electrified')} />
            <TextField label="Колея, мм" type="number" value={t.gauge ?? ''} onCommit={set('gauge')} placeholder="1520" />
          </div>
          <div className="row">
            <TextField label="Скорость, км/ч" type="number" value={t.maxspeed ?? ''} onCommit={set('maxspeed')} placeholder="—" />
            <TextField label="Название линии" value={t.name ?? ''} onCommit={set('name')} />
          </div>
          <p className="hint">Стандартные теги OSM railway, service, usage, electrified, gauge. Сервер жюри строит сети MATSim и SUMO по дорогам, пути в них не попадают; Webots рисует их в 3D.</p>
        </Section>
      ) : (
        <Section title="Платформа">
          <div className="row">
            <TextField label="Название" value={t.name ?? ''} onCommit={set('name')} />
            <TextField label="Номер" value={t.ref ?? ''} onCommit={set('ref')} placeholder="1" />
          </div>
          <p className="hint">railway=platform и public_transport=platform: место посадки у пути.</p>
        </Section>
      )}
      {track && (
        <Section title="Высота">
          <RoadLevelFields ids={[way.id]} tags={t} />
        </Section>
      )}
      <Section title="Все теги OSM" open={false} aside={<span className="mono count">{Object.keys(t).length}</span>}>
        <TagTable tags={t} onChange={(tags) => apply((d) => setWayTags(d, way.id, tags))} />
      </Section>
      <div className="insp-foot">
        <button className="btn btn-danger" onClick={deleteSelection} title="Delete"><Icon name="trash" /> Удалить {track ? 'путь' : 'платформу'}</button>
      </div>
    </div>
  );
}

/** Tags of each station kind: the railway value and the public transport role that goes with it. */
const STATION_TAGS: Readonly<Record<StationKind, { railway: string; public_transport: string }>> = {
  station: { railway: 'station', public_transport: 'station' },
  halt: { railway: 'halt', public_transport: 'station' },
  tram_stop: { railway: 'tram_stop', public_transport: 'stop_position' },
};

export function withStationKind(tags: OsmNode['tags'], kind: StationKind): OsmNode['tags'] {
  return withTag(withTag(tags, 'railway', STATION_TAGS[kind].railway), 'public_transport', STATION_TAGS[kind].public_transport);
}

/** A railway station, halt or tram stop. */
export function StationInspector({ node }: { node: OsmNode }) {
  const apply = useEditor((s) => s.apply);
  const t = node.tags;
  const kind = stationKind(t) ?? 'station';
  const set = (key: string) => (value: string) => apply((d) => setNodeTags(d, node.id, withTag(t, key, value || null)));
  return (
    <div className="inspector">
      <header className="insp-head">
        <span className="micro">{STATION_TYPES.find(([k]) => k === kind)?.[1]}</span>
        <h2 className="insp-title">{t.name || 'Без названия'}</h2>
        <span className="mono insp-id">node {node.id} · {node.lat.toFixed(6)}, {node.lon.toFixed(6)}</span>
      </header>
      <Section title="Станция">
        <SelectField label="Тип" value={kind} options={STATION_TYPES} onChange={(k) => apply((d) => setNodeTags(d, node.id, withStationKind(t, k as StationKind)))} />
        <div className="row">
          <TextField label="Название" value={t.name ?? ''} onCommit={set('name')} />
          <TextField label="Код ЕСР" value={t['railway:ref'] ?? ''} onCommit={set('railway:ref')} placeholder="—" />
        </div>
        <p className="hint">{isPlatform(t) ? 'Узел отмечен ещё и как платформа. ' : ''}Станция — с путевым развитием, остановочный пункт — только посадка, трамвайная остановка — на трамвайном пути.</p>
      </Section>
      <Section title="Все теги OSM" open={false} aside={<span className="mono count">{Object.keys(t).length}</span>}>
        <TagTable tags={t} onChange={(tags) => apply((d) => setNodeTags(d, node.id, tags))} />
      </Section>
      <div className="insp-foot">
        <button className="btn btn-danger" onClick={deleteSelection} title="Delete"><Icon name="trash" /> Удалить</button>
      </div>
    </div>
  );
}
