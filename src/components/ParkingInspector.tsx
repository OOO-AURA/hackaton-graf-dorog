import { setWayTag, setWayTags } from '../osm/edit';
import {
  disabledFor, PARKING_ACCESS, PARKING_FEE, PARKING_KINDS, parkingInfo, parkingKind, retagKind, retagLevels, withCapacity, type ParkingKind,
} from '../osm/parking';
import type { OsmWay } from '../osm/types';
import { useEditor } from '../state/store';
import { deleteSelection } from '../state/actions';
import { SelectField, TextField } from './fields';
import { Section } from './Section';
import { TagTable } from './TagTable';
import { Icon } from './icons';
import { ShapeSection } from './BuildingInspector';

const SURFACES: ReadonlyArray<readonly [string, string]> = [
  ['', 'Не указано'], ['asphalt', 'Асфальт'], ['paving_stones', 'Плитка'], ['concrete', 'Бетон'], ['gravel', 'Щебень'], ['grass_paver', 'Газонная решётка'], ['unpaved', 'Грунт'],
];

/** How many places a car park has: as tagged or by its area, and the places for disabled drivers the rules ask for. */
function PlacesSection({ way }: { way: OsmWay }) {
  const doc = useEditor((s) => s.doc);
  const apply = useEditor((s) => s.apply);
  const info = parkingInfo(doc, way.id);
  if (!info) return null;
  const t = way.tags;
  const places = info.capacity ?? info.estimate;
  const setPlaces = (key: 'capacity' | 'capacity:disabled') => (v: string) => apply((d) => setWayTags(d, way.id, withCapacity(d.ways[way.id].tags, key, v)));
  return (
    <Section title="Места">
      <div className="row">
        <TextField label="Мест всего" type="number" value={t.capacity ?? ''} placeholder={String(info.estimate)} onCommit={setPlaces('capacity')} />
        <TextField label="Для инвалидов" type="number" value={t['capacity:disabled'] ?? ''} placeholder={String(disabledFor(places))} onCommit={setPlaces('capacity:disabled')} />
      </div>
      <dl className="facts">
        <dt>Площадь</dt><dd className="mono">{Math.round(info.areaM2)} м²</dd>
        {info.levels > 1 && <><dt>Уровней</dt><dd className="mono">{info.levels}</dd></>}
        <dt>По площади</dt><dd className="mono">≈ {info.estimate} мест</dd>
      </dl>
      <p className="hint">Оценка по СП 42.13330.2016: 25 м² на машину вместе с проездами{info.levels > 1 ? ', на каждом уровне' : ''}.</p>
      {info.capacity !== null && Math.abs(info.capacity - info.estimate) > Math.max(5, info.estimate * 0.5) && (
        <p className="hint warn">Указано {info.capacity} мест, а на такой площади помещается около {info.estimate}. Проверьте число или контур.</p>
      )}
      {info.disabledShort && (
        <p className="hint warn">Мест для инвалидов меньше, чем требует СП 59.13330.2020: нужно не меньше {disabledFor(places)} (10 %, но не меньше одного).</p>
      )}
      <div className="buttons">
        <button className="btn" onClick={() => setPlaces('capacity')(String(info.estimate))} disabled={info.capacity === info.estimate}>Места по площади</button>
        <button className="btn" onClick={() => setPlaces('capacity:disabled')(String(disabledFor(places)))} disabled={!info.disabledShort}>Места для инвалидов по СП</button>
      </div>
    </Section>
  );
}

/** A car park: kind, places, payment and access in standard OSM tags, its outline shaped like a building's. */
export function ParkingInspector({ way }: { way: OsmWay }) {
  const apply = useEditor((s) => s.apply);
  const t = way.tags;
  const kind = parkingKind(t);
  const set = (key: string) => (value: string) => apply((d) => setWayTag(d, way.id, key, value || null));
  const setKind = (v: string) => apply((d) => setWayTags(d, way.id, retagKind(d.ways[way.id].tags, v as ParkingKind, parkingInfo(d, way.id)?.areaM2 ?? 0)));
  return (
    <div className="inspector">
      <header className="insp-head">
        <span className="micro">Парковка</span>
        <h2 className="insp-title">{t.name || PARKING_KINDS.find(([v]) => v === kind)?.[1] || 'Парковка'}</h2>
        <span className="mono insp-id">way {way.id} · {way.refs.length - 1} углов</span>
      </header>
      <Section title="Парковка">
        <SelectField label="Вид" value={kind} options={PARKING_KINDS} onChange={setKind} />
        <TextField label="Название" value={t.name ?? ''} onCommit={set('name')} />
        <div className="row">
          <SelectField label="Оплата" value={t.fee ?? ''} options={PARKING_FEE} onChange={set('fee')} />
          <SelectField label="Кому можно" value={t.access ?? ''} options={PARKING_ACCESS} onChange={set('access')} />
        </div>
        {kind === 'multi-storey' && (
          <TextField label="Этажей" type="number" value={t['building:levels'] ?? ''} onCommit={(v) => apply((d) => setWayTags(d, way.id, retagLevels(d.ways[way.id].tags, Number(v), parkingInfo(d, way.id)?.areaM2 ?? 0)))} />
        )}
        <div className="row">
          <SelectField label="Покрытие" value={t.surface ?? ''} options={SURFACES} onChange={set('surface')} />
          <TextField label="Стоянка не дольше" value={t.maxstay ?? ''} placeholder="напр. 2 hours" onCommit={set('maxstay')} />
        </div>
        <label className="check" title="park_ride=yes: перехватывающая парковка у остановки общественного транспорта">
          <input type="checkbox" checked={t.park_ride === 'yes' || t.park_ride === 'bus' || t.park_ride === 'train'} onChange={(e) => set('park_ride')(e.target.checked ? 'yes' : '')} />
          Перехватывающая (park and ride)
        </label>
        <p className="hint">Стандартные теги OSM amenity=parking: MATSim и SUMO их пропускают, многоуровневый паркинг Webots строит как здание.</p>
      </Section>
      <PlacesSection way={way} />
      <ShapeSection way={way} parking />
      <Section title="Все теги OSM" open={false} aside={<span className="mono count">{Object.keys(t).length}</span>}>
        <TagTable tags={t} onChange={(tags) => apply((d) => setWayTags(d, way.id, tags))} />
      </Section>
      <div className="insp-foot">
        <button className="btn btn-danger" onClick={deleteSelection} title="Delete"><Icon name="trash" /> Удалить парковку</button>
      </div>
    </div>
  );
}
