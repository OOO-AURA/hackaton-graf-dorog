import { useMemo } from 'react';
import { capacity } from '../osm/profile';
import { commonValue, normaliseStreet, setStreetLanes, setStreetTag, streetLengthM, streetWays } from '../osm/street';
import { DRIVABLE_HIGHWAYS } from '../osm/tags';
import { useEditor } from '../state/store';
import { SelectField, TextField } from './fields';
import { Section } from './Section';
import { HIGHWAY_LABELS } from './WayInspector';
import { useSettledDoc } from '../state/settled';

const SURFACE_OPTIONS = [['asphalt', 'Асфальт'], ['concrete', 'Бетон'], ['paving_stones', 'Плитка'], ['gravel', 'Гравий'], ['unpaved', 'Грунт']] as const;
const MIXED = 'разное';

/** Field value for a group: the shared value, or empty with a "разное" placeholder. */
const shown = (v: string | null) => v ?? '';
const hint = (v: string | null) => (v === null ? MIXED : '—');

/** One panel for every part of a street: lanes, speed, class and surface change on all parts at once. */
export function StreetInspector({ name }: { name: string }) {
  const doc = useSettledDoc();
  const apply = useEditor((s) => s.apply);
  const select = useEditor((s) => s.select);
  const ways = useMemo(() => streetWays(doc, name), [doc, name]);
  const lengthKm = streetLengthM(doc, ways) / 1000;
  const caps = ways.map((w) => capacity(w.tags)).filter((c) => c > 0);
  const capRange = caps.length ? [Math.min(...caps), Math.max(...caps)] : null;
  const setAll = (key: string) => (value: string) => apply((d) => setStreetTag(d, name, key, value || null));
  const highway = commonValue(ways, 'highway');

  return (
    <div className="inspector">
      <header className="insp-head">
        <span className="micro">Улица целиком</span>
        <h2 className="insp-title">{name}</h2>
        <span className="mono insp-id">{ways.length} участков · {lengthKm.toFixed(2)} км</span>
      </header>
      <Section title="Для всех участков">
        <p className="hint">Изменение применится ко всем {ways.length} участкам сразу, одним шагом отмены. «{MIXED}» значит, что сейчас на участках разные значения.</p>
        <SelectField label="Класс" value={shown(highway)} options={[...(highway === null ? [['', MIXED] as const] : []), ...DRIVABLE_HIGHWAYS.map((h) => [h, HIGHWAY_LABELS[h] ?? h] as const)]} onChange={(v) => { if (v) setAll('highway')(v); }} />
        <div className="row">
          <TextField label="Полос" type="number" value={shown(commonValue(ways, 'lanes'))} placeholder={hint(commonValue(ways, 'lanes'))} onCommit={(v) => apply((d) => setStreetLanes(d, name, v || null))} />
          <TextField label="Скорость, км/ч" type="number" value={shown(commonValue(ways, 'maxspeed'))} placeholder={hint(commonValue(ways, 'maxspeed'))} onCommit={setAll('maxspeed')} />
        </div>
        <SelectField label="Покрытие" value={shown(commonValue(ways, 'surface'))} options={[['', commonValue(ways, 'surface') === null ? MIXED : 'Не задано'], ...SURFACE_OPTIONS]} onChange={setAll('surface')} />
        <div className="buttons">
          <button className="btn" onClick={() => apply((d) => normaliseStreet(d, name))}>Привести все участки к норме СП</button>
        </div>
        {capRange && (
          <dl className="facts">
            <dt>Пропускная способность</dt>
            <dd className="mono">{capRange[0] === capRange[1] ? capRange[0] : `${capRange[0]}–${capRange[1]}`} авт/ч в направлении</dd>
          </dl>
        )}
        {capRange && capRange[0] !== capRange[1] && <p className="hint warn">Пропускная способность меняется вдоль улицы: проверьте, не потеряны ли полосы на одном из участков.</p>}
      </Section>
      <Section title="Участки" aside={<span className="mono count">{ways.length}</span>}>
        <ul className="street-parts">
          {ways.map((w) => (
            <li key={w.id}>
              <button className="link" onClick={() => select({ type: 'way', id: w.id })}>
                <span className="mono">way {w.id}</span>
                <span>{w.tags.lanes ? `${w.tags.lanes} пол.` : 'полосы ?'} · {w.tags.maxspeed ? `${w.tags.maxspeed} км/ч` : 'скорость ?'}{w.tags.oneway === 'yes' || w.tags.oneway === '-1' ? ' · одностор.' : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
