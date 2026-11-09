import { setWayTag, setWayTags } from '../osm/edit';
import { direction, DRIVABLE_HIGHWAYS, withTag } from '../osm/tags';
import type { OsmWay, Tags } from '../osm/types';
import { useEditor } from '../state/store';
import { flipSelected, reverseSelected, deleteSelection } from '../state/actions';
import { SelectField, TextField } from './fields';
import { TagTable } from './TagTable';
import { Section } from './Section';
import { Icon } from './icons';
import { LaneStrip } from './LaneStrip';

const HIGHWAY_LABELS: Readonly<Record<string, string>> = {
  motorway: 'Автомагистраль', trunk: 'Скоростная', primary: 'Магистральная', secondary: 'Районная', tertiary: 'Улица местного значения',
  unclassified: 'Без класса', residential: 'Жилая', living_street: 'Жилая зона', service: 'Проезд', road: 'Неизвестная',
  motorway_link: 'Съезд (автомагистраль)', trunk_link: 'Съезд (скоростная)', primary_link: 'Съезд (магистральная)',
  secondary_link: 'Съезд (районная)', tertiary_link: 'Съезд (местная)',
};

const ONEWAY_OPTIONS = [['', 'Двустороннее'], ['yes', 'Одностороннее →'], ['-1', 'Одностороннее ←']] as const;
const STRUCTURE_OPTIONS = [['none', 'Обычная'], ['bridge', 'Мост'], ['tunnel', 'Тоннель']] as const;
const SURFACE_OPTIONS = [['asphalt', 'Асфальт'], ['concrete', 'Бетон'], ['paving_stones', 'Плитка'], ['gravel', 'Гравий'], ['unpaved', 'Грунт']] as const;

function structureTags(tags: Tags, kind: string): Tags {
  const cleared = withTag(withTag(withTag(tags, 'bridge', null), 'tunnel', null), 'layer', null);
  if (kind === 'bridge') return { ...cleared, bridge: 'yes', layer: '1' };
  if (kind === 'tunnel') return { ...cleared, tunnel: 'yes', layer: '-1' };
  return cleared;
}

export function WayInspector({ way }: { way: OsmWay }) {
  const apply = useEditor((s) => s.apply);
  const t = way.tags;
  const set = (key: string) => (value: string) => apply((d) => setWayTag(d, way.id, key, value || null));
  const dir = direction(t);
  const structure = t.bridge && t.bridge !== 'no' ? 'bridge' : t.tunnel && t.tunnel !== 'no' ? 'tunnel' : 'none';

  return (
    <div className="inspector">
      <header className="insp-head">
        <span className="micro">Дорога</span>
        <h2 className="insp-title">{t.name || HIGHWAY_LABELS[t.highway ?? ''] || 'Без названия'}</h2>
        <span className="mono insp-id">way {way.id} · {way.refs.length} узл.</span>
      </header>
      <Section title="Свойства">
        <SelectField label="Класс" value={t.highway ?? ''} options={DRIVABLE_HIGHWAYS.map((h) => [h, HIGHWAY_LABELS[h] ?? h] as const)} onChange={set('highway')} />
        <TextField label="Название" value={t.name ?? ''} onCommit={set('name')} />
        <div className="row">
          <TextField label="Скорость, км/ч" type="number" value={t.maxspeed ?? ''} onCommit={set('maxspeed')} placeholder="—" />
          <SelectField label="Покрытие" value={t.surface ?? ''} options={SURFACE_OPTIONS} onChange={set('surface')} />
        </div>
      </Section>
      <Section title="Полосы и направление">
        <LaneStrip tags={t} />
        <SelectField label="Движение" value={t.oneway === 'yes' || t.oneway === '-1' ? t.oneway : ''} options={ONEWAY_OPTIONS} onChange={set('oneway')} />
        <div className="row">
          <TextField label="Полос всего" type="number" value={t.lanes ?? ''} onCommit={set('lanes')} placeholder="—" />
          {dir === 'both' && <TextField label="Туда →" type="number" value={t['lanes:forward'] ?? ''} onCommit={set('lanes:forward')} />}
          {dir === 'both' && <TextField label="Обратно ←" type="number" value={t['lanes:backward'] ?? ''} onCommit={set('lanes:backward')} />}
        </div>
        <TextField label="Повороты по полосам, turn:lanes" value={t['turn:lanes'] ?? ''} onCommit={set('turn:lanes')} placeholder="left|through|through;right" />
        <div className="buttons">
          <button className="btn" onClick={flipSelected} disabled={dir === 'both'} title="F"><Icon name="flip" /> Сменить направление <kbd>F</kbd></button>
          <button className="btn" onClick={reverseSelected} title="R"><Icon name="reverse" /> Развернуть линию <kbd>R</kbd></button>
        </div>
      </Section>
      <Section title="Сооружение">
        <div className="row">
          <SelectField label="Тип" value={structure} options={STRUCTURE_OPTIONS} onChange={(k) => apply((d) => setWayTags(d, way.id, structureTags(t, k)))} />
          <TextField label="Уровень, layer" type="number" value={t.layer ?? ''} onCommit={set('layer')} placeholder="0" />
        </div>
      </Section>
      <Section title="Все теги OSM" open={false} aside={<span className="mono count">{Object.keys(t).length}</span>}>
        <TagTable tags={t} onChange={(tags) => apply((d) => setWayTags(d, way.id, tags))} />
      </Section>
      <div className="insp-foot">
        <button className="btn btn-danger" onClick={deleteSelection} title="Delete"><Icon name="trash" /> Удалить дорогу</button>
      </div>
    </div>
  );
}
