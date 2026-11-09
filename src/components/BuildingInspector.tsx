import { setWayTag, setWayTags } from '../osm/edit';
import {
  BUILDING_TYPES, buildingHeight, heightFromLevels, LEVEL_HEIGHT_M, levelsFromHeight, ROOF_MATERIALS, ROOF_SHAPES, WALL_MATERIALS,
} from '../osm/building';
import type { OsmWay } from '../osm/types';
import { useEditor } from '../state/store';
import { deleteSelection } from '../state/actions';
import { useUi } from '../state/ui';
import { SelectField, TextField } from './fields';
import { Section } from './Section';
import { TagTable } from './TagTable';
import { Icon } from './icons';
import { BuildingHeightFields } from './HeightFields';

const SOURCE_TEXT = {
  height: 'по тегу height',
  levels: `по этажности, ${LEVEL_HEIGHT_M} м на этаж, как считает Webots`,
  none: 'не задана: Webots поставит высоту по умолчанию',
} as const;

const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

/** Colour picker that writes a #rrggbb tag; empty means "not set". */
function ColourField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field colour-field">
      <span>{label}</span>
      <span className="colour-row">
        <input type="color" value={HEX_COLOUR.test(value) ? value : '#c8c3b8'} onChange={(e) => onChange(e.target.value)} aria-label={label} />
        <button type="button" className="btn btn-quiet" onClick={() => onChange('')} disabled={!value}>Сбросить</button>
      </span>
    </label>
  );
}

/** Attributes Webots builds the 3D scene from: floors, height, roof, materials, colours. */
export function BuildingInspector({ way }: { way: OsmWay }) {
  const apply = useEditor((s) => s.apply);
  const view3d = useUi((s) => s.view3d);
  const toggle3d = useUi((s) => s.toggle3d);
  const t = way.tags;
  const set = (key: string) => (value: string) => apply((d) => setWayTag(d, way.id, key, value || null));
  const height = buildingHeight(t);
  const typeKey = t.building ? 'building' : 'building:part';

  return (
    <div className="inspector">
      <header className="insp-head">
        <span className="micro">Здание</span>
        <h2 className="insp-title">{t.name || [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(', ') || 'Без названия'}</h2>
        <span className="mono insp-id">way {way.id} · {way.refs.length - 1} углов</span>
      </header>
      <Section title="Высота для 3D">
        <dl className="facts">
          <dt>Высота в Webots</dt><dd className="mono">{height.metres === null ? '—' : `${height.metres} м`}</dd>
        </dl>
        <p className={`hint${height.source === 'none' ? ' warn' : ''}`}>Высота {SOURCE_TEXT[height.source]}.</p>
        <BuildingHeightFields ids={[way.id]} tags={t} />
        <div className="row">
          <TextField label="Высота крыши, м" type="number" value={t['roof:height'] ?? ''} onCommit={set('roof:height')} placeholder="—" />
        </div>
        <div className="buttons">
          <button className="btn" disabled={!t['building:levels']} onClick={() => apply((d) => setWayTags(d, way.id, heightFromLevels(t)))}>Высота по этажам</button>
          <button className="btn" disabled={!t.height} onClick={() => apply((d) => setWayTags(d, way.id, levelsFromHeight(t)))}>Этажи по высоте</button>
          <button className="btn btn-quiet" onClick={toggle3d}>{view3d ? 'Вернуть 2D' : 'Показать в 3D'} <kbd>P</kbd></button>
        </div>
      </Section>
      <Section title="Тип и крыша">
        <SelectField label="Тип здания" value={t[typeKey] ?? ''} options={BUILDING_TYPES} onChange={set(typeKey)} />
        <TextField label="Название" value={t.name ?? ''} onCommit={set('name')} />
        <div className="row">
          <SelectField label="Форма крыши" value={t['roof:shape'] ?? ''} options={[['', 'Не задана'], ...ROOF_SHAPES]} onChange={set('roof:shape')} />
          <SelectField label="Кровля" value={t['roof:material'] ?? ''} options={[['', 'Не задана'], ...ROOF_MATERIALS]} onChange={set('roof:material')} />
        </div>
      </Section>
      <Section title="Фасад" open={false}>
        <SelectField label="Материал стен" value={t['building:material'] ?? ''} options={[['', 'Не задан'], ...WALL_MATERIALS]} onChange={set('building:material')} />
        <div className="row">
          <ColourField label="Цвет фасада" value={t['building:colour'] ?? ''} onChange={set('building:colour')} />
          <ColourField label="Цвет крыши" value={t['roof:colour'] ?? ''} onChange={set('roof:colour')} />
        </div>
      </Section>
      <Section title="Все теги OSM" open={false} aside={<span className="mono count">{Object.keys(t).length}</span>}>
        <TagTable tags={t} onChange={(tags) => apply((d) => setWayTags(d, way.id, tags))} />
      </Section>
      <div className="insp-foot">
        <button className="btn btn-danger" onClick={deleteSelection} title="Delete"><Icon name="trash" /> Удалить здание</button>
      </div>
    </div>
  );
}
