import { DRIVABLE_HIGHWAYS, isDrivable } from '../osm/tags';
import { joinWays, setWayTag, setWayTags } from '../osm/edit';
import type { OsmDoc } from '../osm/types';
import { withLaneCount } from '../osm/profile';
import { safeInput } from '../osm/pipelineSafety';
import { useEditor } from '../state/store';
import { SelectField, TextField } from './fields';
import { HIGHWAY_LABELS } from './WayInspector';
import { Section } from './Section';
import { BuildingHeightFields, RoadLevelFields } from './HeightFields';
import { useSettledDoc } from '../state/settled';

const SURFACES = [['asphalt', 'Асфальт'], ['concrete', 'Бетон'], ['paving_stones', 'Плитка'], ['gravel', 'Гравий'], ['unpaved', 'Грунт']] as const;
const ONEWAYS = [['', 'Двустороннее'], ['yes', 'Одностороннее →'], ['-1', 'Одностороннее ←']] as const;
const HGV = [['', 'Без ограничений'], ['no', 'Запрещено'], ['destination', 'Только к месту назначения']] as const;

/** The value all the ways share, or '' when they differ. */
const common = (doc: OsmDoc, ids: readonly string[], key: string, mixed = ''): string => {
  const vals = new Set(ids.map((id) => doc.ways[id]?.tags[key] ?? ''));
  return vals.size === 1 ? [...vals][0] : mixed;
};
/** Shown by a list when the roads differ: not one of its options, so no option looks chosen. */
const MIXED = '—';

/** Fields every selected road takes at once: class, speed, lanes, direction, surface, trucks. */
function RoadFields({ ids, doc }: { ids: readonly string[]; doc: OsmDoc }) {
  const apply = useEditor((s) => s.apply);
  const notify = useEditor((s) => s.notify);
  const differs = (key: string) => new Set(ids.map((id) => doc.ways[id]?.tags[key] ?? '')).size > 1;
  const set = (key: string) => (value: string) => {
    const safe = safeInput(key, value);
    if (value.trim() && safe !== value.trim()) notify(`${key}: значение «${value}» не подходит`);
    apply((d) => ids.reduce((acc, id) => (!acc.ways[id] ? acc : key === 'lanes' ? setWayTags(acc, id, withLaneCount(acc.ways[id].tags, key, safe)) : setWayTag(acc, id, key, safe)), d));
    notify(`${key} задано у ${ids.length} дорог`);
  };
  const ph = (key: string) => (differs(key) ? 'разные' : '—');
  return (
    <>
      <div className="row">
        <SelectField label={differs('highway') ? 'Класс (разные)' : 'Класс'} value={common(doc, ids, 'highway', MIXED)} options={DRIVABLE_HIGHWAYS.map((h) => [h, HIGHWAY_LABELS[h] ?? h] as const)} onChange={set('highway')} />
        <SelectField label={differs('surface') ? 'Покрытие (разные)' : 'Покрытие'} value={common(doc, ids, 'surface', MIXED)} options={SURFACES} onChange={set('surface')} />
      </div>
      <div className="row">
        <TextField label="Скорость, км/ч" type="number" value={common(doc, ids, 'maxspeed')} placeholder={ph('maxspeed')} onCommit={set('maxspeed')} />
        <TextField label="Полос всего" type="number" value={common(doc, ids, 'lanes')} placeholder={ph('lanes')} onCommit={set('lanes')} />
      </div>
      <div className="row">
        <SelectField label={differs('oneway') ? 'Движение (разное)' : 'Движение'} value={common(doc, ids, 'oneway', MIXED)} options={ONEWAYS} onChange={set('oneway')} />
        <SelectField label="Грузовикам" value={common(doc, ids, 'hgv', MIXED)} options={HGV} onChange={set('hgv')} />
      </div>
    </>
  );
}

/** Two roads meeting end to end become one: fewer pieces, one set of tags. */
function JoinButton({ ids }: { ids: readonly string[] }) {
  const doc = useEditor((s) => s.doc);
  const apply = useEditor((s) => s.apply);
  const select = useEditor((s) => s.select);
  const notify = useEditor((s) => s.notify);
  if (ids.length !== 2) return null;
  const probe = joinWays(doc, ids[0], ids[1]);
  return (
    <button className="btn" disabled={!probe} title={probe ? 'Вторая дорога присоединится к первой и возьмёт её теги' : 'Объединяются две дороги, сходящиеся концами и не входящие в запреты поворотов или маршруты'}
      onClick={() => {
        let differing: string[] = [];
        apply((d) => { const r = joinWays(d, ids[0], ids[1]); if (!r) return d; differing = r.differing; return r.doc; });
        select({ type: 'way', id: ids[0] });
        notify(differing.length ? `Дороги объединены, теги взяты у первой; отличались: ${differing.join(', ')}` : 'Дороги объединены');
      }}>Объединить в одну</button>
  );
}

/** Several ways selected with a frame: their height and the common road fields are set for all of them at once. */
export function MultiInspector({ ids }: { ids: readonly string[] }) {
  const doc = useSettledDoc();
  const selectMany = useEditor((s) => s.selectMany);
  const buildings = ids.filter((id) => doc.ways[id]?.tags.building);
  const roads = ids.filter((id) => doc.ways[id] && isDrivable(doc.ways[id].tags));
  return (
    <div className="inspector">
      <header className="insp-head">
        <span className="micro">Выбрано несколько</span>
        <h2 className="insp-title">{ids.length} объектов</h2>
        <span className="mono insp-id">{buildings.length} зданий · {roads.length} дорог</span>
      </header>
      {buildings.length > 0 && (
        <Section title={`Высота зданий · ${buildings.length}`}>
          <BuildingHeightFields ids={buildings} tags={doc.ways[buildings[0]].tags} />
        </Section>
      )}
      {roads.length > 0 && (
        <Section title={`Свойства дорог · ${roads.length}`}>
          <RoadFields ids={roads} doc={doc} />
        </Section>
      )}
      {roads.length > 0 && (
        <Section title={`Уровень дорог · ${roads.length}`}>
          <RoadLevelFields ids={roads} tags={doc.ways[roads[0]].tags} />
        </Section>
      )}
      <div className="multi-foot">
      <p className="hint">Рамка с Shift выбирает здания и дороги. Значения применяются ко всем сразу и отменяются одним Ctrl+Z.</p>
      <div className="buttons">
        {buildings.length > 0 && roads.length > 0 && <button className="btn" onClick={() => selectMany(buildings)}>Только здания</button>}
        {buildings.length > 0 && roads.length > 0 && <button className="btn" onClick={() => selectMany(roads)}>Только дороги</button>}
        <JoinButton ids={roads.length === ids.length ? roads : []} />
        <button className="btn" onClick={() => selectMany([])}>Снять выделение</button>
      </div>
      </div>
    </div>
  );
}
