import type { OsmDoc, OsmWay } from '../osm/types';
import { setWayTags } from '../osm/edit';
import { SIDEWALK_W, sidewalkSurface, sidewalkWidth, taggedSidewalks, withSidewalks, withSidewalkSurface, withSidewalkWidth, type SidewalkSides } from '../osm/sidewalks';
import { sidewalkSides } from '../map/geojson';
import { Section } from './Section';

const SIDES: ReadonlyArray<readonly [SidewalkSides, string]> = [['both', 'Обе стороны'], ['left', 'Слева'], ['right', 'Справа'], ['no', 'Нет']];
const SURFACES: ReadonlyArray<readonly [string, string]> = [['', 'Не указано'], ['paving_stones', 'Плитка'], ['asphalt', 'Асфальт'], ['concrete', 'Бетон'], ['gravel', 'Гравий']];

/**
 * Sidewalks of the road (or of the stretch picked: the edit cuts it out first): which sides, how
 * wide, what surface. Left and right are of the way's direction, the arrows on the map.
 */
export function SidewalkSection({ way, apply }: { way: OsmWay; apply: (edit: (d: OsmDoc) => OsmDoc) => void }) {
  const t = way.tags;
  const tagged = taggedSidewalks(t);
  const drawn = sidewalkSides(t);
  const shown: SidewalkSides = tagged ?? (drawn === 'lr' ? 'both' : drawn === 'l' ? 'left' : drawn === 'r' ? 'right' : 'no');
  const width = sidewalkWidth(t);
  const set = (edit: (tags: OsmWay['tags']) => OsmWay['tags']) => apply((d) => setWayTags(d, way.id, edit(d.ways[way.id].tags)));
  return (
    <Section title="Тротуары" aside={<span className="mono count">{SIDES.find(([v]) => v === shown)?.[1].toLowerCase()}</span>}>
      <div className="seg seg-wide sidewalk-seg" role="radiogroup" aria-label="Тротуары">
        {SIDES.map(([v, label]) => (
          <button key={v} role="radio" aria-checked={shown === v} className={shown === v ? 'on' : ''} onClick={() => set((tags) => withSidewalks(tags, v))}>{label}</button>
        ))}
      </div>
      {!tagged && <p className="hint">Тег не задан: {drawn ? 'городская улица считается с тротуарами с обеих сторон' : 'тротуаров нет'}. Кнопка запишет sidewalk явно.</p>}
      {shown !== 'no' && (
        <div className="row">
          <label className="field">
            <span className="micro">Ширина, м</span>
            <input type="number" min={0.8} max={8} step={0.25} placeholder={String(SIDEWALK_W)} defaultValue={width ?? ''} key={width ?? 'none'}
              onBlur={(e) => { const v = Number.parseFloat(e.target.value.replace(',', '.')); set((tags) => withSidewalkWidth(withSidewalks(tags, shown), Number.isFinite(v) && v > 0 ? v : null)); }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
          </label>
          <label className="field">
            <span className="micro">Покрытие</span>
            <select value={sidewalkSurface(t) ?? ''} onChange={(e) => set((tags) => withSidewalkSurface(withSidewalks(tags, shown), e.target.value))}>
              {SURFACES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        </div>
      )}
      <p className="hint">Слева и справа — по направлению линии (стрелки на карте). Отдельный тротуар произвольной линией рисуется инструментом «Дорога», заготовка «Тротуар».</p>
    </Section>
  );
}
