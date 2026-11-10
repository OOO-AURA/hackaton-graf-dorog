import { useState } from 'react';
import { setWayTag, setWayTags } from '../osm/edit';
import { direction, DRIVABLE_HIGHWAYS } from '../osm/tags';
import type { OsmDoc, OsmWay, Tags } from '../osm/types';
import { useEditor } from '../state/store';
import { flipSelected, reverseSelected, deleteSelection } from '../state/actions';
import { SelectField, TextField } from './fields';
import { TagTable } from './TagTable';
import { Section } from './Section';
import { Icon } from './icons';
import { LaneStrip, type LanePick } from './LaneStrip';
import { capacity, lanesByDirection, normTags, roadProfile, withLaneCount } from '../osm/profile';
import { RoadLevelFields } from './HeightFields';
import { streetWays } from '../osm/street';
import { webotsElevation } from '../osm/structures';
import { simulatorSpeeds } from '../osm/speeds';
import { safeInput } from '../osm/pipelineSafety';
import { SimulatorsSection } from './SimulatorsSection';
import { useSettledDoc } from '../state/settled';
import { BusLaneFields } from './BusParts';
import { isolatePiece } from '../osm/pieces';
import { LaneEditor } from './LaneEditor';
import { SidewalkSection } from './SidewalkSection';
import { useUi } from '../state/ui';
import { haversine } from '../osm/geo';

export const HIGHWAY_LABELS: Readonly<Record<string, string>> = {
  motorway: 'Автомагистраль', trunk: 'Скоростная', primary: 'Магистральная', secondary: 'Районная', tertiary: 'Улица местного значения',
  unclassified: 'Без класса', residential: 'Жилая', living_street: 'Жилая зона', service: 'Проезд', road: 'Неизвестная',
  motorway_link: 'Съезд (автомагистраль)', trunk_link: 'Съезд (скоростная)', primary_link: 'Съезд (магистральная)',
  secondary_link: 'Съезд (районная)', tertiary_link: 'Съезд (местная)',
};

const ONEWAY_OPTIONS = [['', 'Двустороннее'], ['yes', 'Одностороннее →'], ['-1', 'Одностороннее ←']] as const;
const SURFACE_OPTIONS = [['asphalt', 'Асфальт'], ['concrete', 'Бетон'], ['paving_stones', 'Плитка'], ['gravel', 'Гравий'], ['unpaved', 'Грунт']] as const;

const ACCESS_OPTIONS = [['', 'Без ограничений'], ['no', 'Запрещено'], ['destination', 'Только к месту назначения']] as const;
const BUS_OPTIONS = [['', 'Нет'], ['yes', 'Одна полоса']] as const;
const YES_NO = [['', 'Не указано'], ['yes', 'Да'], ['no', 'Нет']] as const;
const CYCLEWAY_OPTIONS = [['', 'Нет'], ['lane', 'Велополоса'], ['track', 'Отдельная велодорожка'], ['shared_lane', 'Общая полоса']] as const;
const PARKING_OPTIONS = [['', 'Не указано'], ['no', 'Нет'], ['lane', 'На проезжей части'], ['street_side', 'Карманы у края']] as const;
const MOTOR_OPTIONS = [['', 'Разрешено'], ['no', 'Запрещено'], ['destination', 'Только к месту назначения'], ['private', 'Только своим']] as const;


/** What MATSim and SUMO will take as the speed of this road when maxspeed is missing or not a number. */
function SpeedNote({ tags }: { tags: Tags }) {
  const s = simulatorSpeeds(tags);
  if (s.matsim === s.sumo) return null;
  const v = (x: number | null) => (x === null ? 'нет' : `${x} км/ч`);
  return <p className="hint warn speed-note">Скорость в симуляторах разная: MATSim {v(s.matsim)}, SUMO {v(s.sumo)}. Укажите число, чтобы все уровни ехали одинаково.</p>;
}

/** Where the Webots importer will put this road: it lifts or sinks a whole way by layer × 5 m. */
function elevationHint(t: Tags): string {
  const z = webotsElevation(t);
  if (z === null) return 'Webots не строит дороги с отрицательным layer: в 3D её не будет. Если это дорога под мостом, а не настоящий тоннель, оставьте её на уровне 0.';
  if (z > 0) return `В 3D и в Webots дорога пройдёт на ${z} м над землёй (layer × 5 м). Подъезды в редакторе показаны насыпью с плавным подъёмом.`;
  return 'Дорога на уровне земли.';
}

/** Length along the nodes, metres or kilometres. */
function formatLength(doc: OsmDoc, refs: readonly string[]): string {
  let m = 0;
  for (let i = 1; i < refs.length; i++) {
    const a = doc.nodes[refs[i - 1]], b = doc.nodes[refs[i]];
    if (a && b) m += haversine([a.lon, a.lat], [b.lon, b.lat]);
  }
  return m >= 1000 ? `${(m / 1000).toFixed(2)} км` : `${Math.round(m)} м`;
}

export function WayInspector({ way }: { way: OsmWay }) {
  const storeApply = useEditor((s) => s.apply);
  // The lane picked in the strip for editing on its own.
  const [lane, setLane] = useState<LanePick | null>(null);
  const piece = useEditor((s) => (s.selection?.type === 'way' && s.selection.id === way.id ? s.selection.piece : undefined));
  // With a stretch picked, the first edit cuts it out of its way (it keeps the way's id), so the
  // edit and the ones after it apply to the stretch only.
  const apply = (edit: (d: OsmDoc) => OsmDoc) => {
    storeApply((d) => edit(piece ? isolatePiece(d, way.id, piece) : d));
    if (piece) select({ type: 'way', id: way.id });
  };
  const select = useEditor((s) => s.select);
  const sidewalksOnly = useUi((s) => s.lens === 'walk');
  const doc = useSettledDoc();
  const t = way.tags;
  const streetParts = t.name ? streetWays(doc, t.name).length : 0;
  const notify = useEditor((s) => s.notify);
  // Lane counts and layer go through the same guard as validation: other values stop the Webots import.
  const set = (key: string) => (value: string) => {
    const safe = safeInput(key, value);
    if (value.trim() && safe !== value.trim()) notify(safe ? `${key}: записано ${safe}, Webots принимает только целое число` : `${key}: значение «${value}» не подходит, тег не записан`);
    if (key === 'lanes' || key === 'lanes:forward' || key === 'lanes:backward') apply((d) => setWayTags(d, way.id, withLaneCount(d.ways[way.id].tags, key, safe)));
    else apply((d) => setWayTag(d, way.id, key, safe));
  };
  const dir = direction(t);
  const profile = roadProfile(t);
  // What the map, SUMO and MATSim take per direction, shown where a count is not tagged.
  const split = lanesByDirection(t);

  return (
    <div className="inspector">
      <header className="insp-head">
        <span className="micro">Дорога</span>
        <h2 className="insp-title">{t.name || HIGHWAY_LABELS[t.highway ?? ''] || 'Без названия'}</h2>
        <span className="mono insp-id">way {way.id} · {piece ? `участок ${formatLength(doc, way.refs.slice(piece.from, piece.to + 1))}, ${piece.to - piece.from + 1} узл. из ${way.refs.length}` : `${formatLength(doc, way.refs)}, ${way.refs.length} узл.`}</span>
        {piece && <button className="link" onClick={() => select({ type: 'way', id: way.id })}>Править всю линию</button>}
        {streetParts > 1 && <button className="link" onClick={() => select({ type: 'street', id: t.name })}>Вся улица: {streetParts} участков, править разом</button>}
      </header>
      {/* In the walking view the road is picked for its sidewalks only. */}
      {sidewalksOnly && <SidewalkSection way={way} apply={apply} />}
      {!sidewalksOnly && <>
      <Section title="Свойства">
        <SelectField label="Класс" value={t.highway ?? ''} options={DRIVABLE_HIGHWAYS.map((h) => [h, HIGHWAY_LABELS[h] ?? h] as const)} onChange={set('highway')} />
        <TextField label="Название" value={t.name ?? ''} onCommit={set('name')} />
        <div className="row">
          <TextField label="Скорость, км/ч" type="number" value={t.maxspeed ?? ''} onCommit={set('maxspeed')} placeholder="—" />
          <SelectField label="Покрытие" value={t.surface ?? ''} options={SURFACE_OPTIONS} onChange={set('surface')} />
        </div>
      </Section>
      <SpeedNote tags={t} />
      <Section title="Полосы и направление">
        <LaneStrip tags={t} selected={lane} onPick={(l) => setLane(lane && lane.travel === l.travel && lane.index === l.index ? null : l)} />
        {lane && <LaneEditor way={way} travel={lane.travel} index={lane.index} apply={apply} onClose={() => setLane(null)} />}
        <SelectField label="Движение" value={t.oneway === 'yes' || t.oneway === '-1' ? t.oneway : ''} options={ONEWAY_OPTIONS} onChange={set('oneway')} />
        <div className="row">
          <TextField label="Полос всего" type="number" value={t.lanes ?? ''} onCommit={set('lanes')} placeholder={String(split.forward + split.backward)} />
          {dir === 'both' && <TextField label="Туда →" type="number" value={t['lanes:forward'] ?? ''} onCommit={set('lanes:forward')} placeholder={String(split.forward)} />}
          {dir === 'both' && <TextField label="Обратно ←" type="number" value={t['lanes:backward'] ?? ''} onCommit={set('lanes:backward')} placeholder={String(split.backward)} />}
        </div>
        {dir === 'both' ? (
          // On a two-way road each direction has its own list, from its own left: SUMO and the lane links read these.
          <div className="row">
            <TextField label="Повороты туда →" value={t['turn:lanes:forward'] ?? ''} onCommit={set('turn:lanes:forward')} placeholder="left|through" />
            <TextField label="Повороты обратно ←" value={t['turn:lanes:backward'] ?? ''} onCommit={set('turn:lanes:backward')} placeholder="through|right" />
          </div>
        ) : (
          <TextField label="Повороты по полосам, turn:lanes" value={t['turn:lanes'] ?? ''} onCommit={set('turn:lanes')} placeholder="left|through|through;right" />
        )}
        <div className="buttons">
          <button className="btn" onClick={flipSelected} disabled={dir === 'both'} title="F"><Icon name="flip" /> Сменить направление <kbd>F</kbd></button>
          <button className="btn" onClick={reverseSelected} title="R"><Icon name="reverse" /> Развернуть линию <kbd>R</kbd></button>
        </div>
        <label className="check" title="priority_road=designated. На перекрёстках без светофора у въездов этой дороги стоит знак 2.1">
          <input type="checkbox" checked={t.priority_road === 'designated'} onChange={(e) => set('priority_road')(e.target.checked ? 'designated' : '')} />
          Главная дорога (знак 2.1)
        </label>
        <BusLaneFields way={way} />
      </Section>
      {profile && (
        <Section title="Профиль по СП">
          <dl className="facts">
            <dt>Категория</dt><dd>{profile.category}</dd>
            <dt>Ширина полосы</dt><dd className="mono">{profile.laneWidth} м</dd>
            <dt>Расчётная скорость</dt><dd className="mono">{profile.designSpeed} км/ч</dd>
            <dt>Пропускная способность</dt><dd className="mono">{capacity(t)} авт/ч в направлении</dd>
          </dl>
          <p className="hint">СП 42.13330.2016 для улиц, СП 34.13330.2021 для дорог. Кнопка заполнит ширину и ограничение скорости, если их нет.</p>
          <div className="buttons">
            <button className="btn" disabled={!!t.width && !!t.maxspeed} onClick={() => apply((d) => setWayTags(d, way.id, normTags(t)))}>Привести к норме</button>
          </div>
        </Section>
      )}
      <SimulatorsSection tags={t} />
      <Section title="Ограничения" open={false}>
        <div className="row">
          <TextField label="Масса, т" type="number" value={t.maxweight ?? ''} onCommit={set('maxweight')} placeholder="—" />
          <TextField label="Высота, м" type="number" value={t.maxheight ?? ''} onCommit={set('maxheight')} placeholder="—" />
        </div>
        <div className="row">
          <SelectField label="Грузовикам" value={t.hgv ?? ''} options={ACCESS_OPTIONS} onChange={set('hgv')} />
          <SelectField label="Автобусная полоса" value={t['lanes:bus'] ? 'yes' : ''} options={BUS_OPTIONS} onChange={(v) => apply((d) => setWayTag(d, way.id, 'lanes:bus', v ? '1' : null))} />
        </div>
      </Section>
      <Section title="Дополнительно" open={false}>
        <div className="row">
          <TextField label="Ширина проезжей части, м" type="number" value={t.width ?? ''} onCommit={set('width')} placeholder={profile ? String(Math.round(profile.laneWidth * (split.forward + split.backward) * 10) / 10) : '—'} />
          <TextField label="Мин. скорость, км/ч" type="number" value={t.minspeed ?? ''} onCommit={set('minspeed')} placeholder="—" />
        </div>
        <div className="row">
          <TextField label="Скорость грузовых, км/ч" type="number" value={t['maxspeed:hgv'] ?? ''} onCommit={set('maxspeed:hgv')} placeholder="—" />
          <SelectField label="Машинам" value={t.motor_vehicle ?? ''} options={MOTOR_OPTIONS} onChange={set('motor_vehicle')} />
        </div>
        <div className="row">
          <SelectField label="Обгон" value={t.overtaking ?? ''} options={YES_NO} onChange={set('overtaking')} />
          <SelectField label="Освещение" value={t.lit ?? ''} options={YES_NO} onChange={set('lit')} />
        </div>
        <div className="row">
          <SelectField label="Велосипедистам" value={t.cycleway ?? ''} options={CYCLEWAY_OPTIONS} onChange={set('cycleway')} />
          <SelectField label="Парковка вдоль" value={t['parking:both'] ?? ''} options={PARKING_OPTIONS} onChange={set('parking:both')} />
        </div>
        <label className="check" title="junction=roundabout: движение по кольцу против часовой стрелки, въезжающие уступают. SUMO строит кольцо с приоритетом едущих по нему">
          <input type="checkbox" checked={t.junction === 'roundabout'} onChange={(e) => set('junction')(e.target.checked ? 'roundabout' : '')} />
          Кольцевое движение
        </label>
        <p className="hint">Ширину, кольцо и доступ машинам читает SUMO, ширину — ещё и Webots. Остальное — стандартные теги OSM для паспорта дороги.</p>
      </Section>
      <SidewalkSection way={way} apply={apply} />
      <Section title="Высота">
        <RoadLevelFields ids={[way.id]} tags={t} />
        <p className={`hint${webotsElevation(t) === null ? ' warn' : ''}`}>{elevationHint(t)}</p>
      </Section>
      <Section title="Все теги OSM" open={false} aside={<span className="mono count">{Object.keys(t).length}</span>}>
        <TagTable tags={t} onChange={(tags) => apply((d) => setWayTags(d, way.id, tags))} />
      </Section>
      <div className="insp-foot">
        <button className="btn btn-danger" onClick={deleteSelection} title="Delete"><Icon name="trash" /> Удалить дорогу</button>
      </div>
      </>}
    </div>
  );
}
