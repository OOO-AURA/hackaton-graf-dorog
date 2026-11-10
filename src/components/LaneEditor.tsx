import { laneInfo, setLanePsv, setLaneTurns, setLaneValue, type Travel } from '../osm/laneTags';
import { setWayTags } from '../osm/edit';
import type { OsmDoc, OsmWay } from '../osm/types';
import { TextField } from './fields';

/**
 * One lane of the selected road: where it may go, whether it is for route vehicles and taxis,
 * its width and speed limit. Written to the road's `*:lanes` tags for that lane only.
 */

const TURN_CHOICES: ReadonlyArray<readonly [string, string, string]> = [
  ['left', '←', 'налево'], ['slight_left', '↖', 'плавно налево'], ['through', '↑', 'прямо'],
  ['slight_right', '↗', 'плавно направо'], ['right', '→', 'направо'], ['reverse', '↶', 'разворот'],
];

const num = (v: string) => (v.trim() === '' ? '' : String(Math.round(Number.parseFloat(v.replace(',', '.')) * 100) / 100));

export function LaneEditor({ way, travel, index, apply, onClose }: {
  way: OsmWay; travel: Travel; index: number; apply: (edit: (d: OsmDoc) => OsmDoc) => void; onClose: () => void;
}) {
  const t = way.tags;
  const lane = laneInfo(t, travel, index);
  const put = (tags: typeof t) => apply((d) => setWayTags(d, way.id, tags));
  const toggleTurn = (turn: string) => put(setLaneTurns(t, travel, index, lane.turns.includes(turn) ? lane.turns.filter((x) => x !== turn) : [...lane.turns, turn]));
  return (
    <div className="lane-editor">
      <div className="lane-editor-head">
        <b>Полоса {index + 1} {travel === 'forward' ? 'туда →' : 'обратно ←'}</b>
        <span className="hint">слева направо по ходу движения</span>
        <button className="icon-btn" onClick={onClose} aria-label="Закрыть" title="Закрыть">✕</button>
      </div>
      <span className="micro">Направления</span>
      <div className="lane-turns">
        {TURN_CHOICES.map(([id, glyph, name]) => (
          <button key={id} className={`jc-turn${lane.turns.includes(id) ? ' on' : ''}`} aria-pressed={lane.turns.includes(id)} title={name} onClick={() => toggleTurn(id)}>{glyph}</button>
        ))}
      </div>
      <p className="hint">{lane.turns.length ? 'turn:lanes для этой полосы.' : 'Не задано: на перекрёстке полоса едет по обычным правилам.'}</p>
      <label className="check" title="psv:lanes=designated: только маршрутные ТС и такси">
        <input type="checkbox" checked={lane.psv} onChange={(e) => put(setLanePsv(t, travel, index, e.target.checked))} />
        Только для ОТ и такси (буква «А»)
      </label>
      <div className="row">
        <TextField label="Ширина, м" type="number" value={lane.width} placeholder="3.5" onCommit={(v) => put(setLaneValue(t, 'width:lanes', travel, index, num(v)))} />
        <TextField label="Скорость, км/ч" type="number" value={lane.maxspeed} placeholder={t.maxspeed ?? '—'} onCommit={(v) => put(setLaneValue(t, 'maxspeed:lanes', travel, index, num(v)))} />
      </div>
    </div>
  );
}
