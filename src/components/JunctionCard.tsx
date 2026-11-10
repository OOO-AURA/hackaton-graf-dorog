import {
  applyJunctionTemplate, armKey, classifyTurn, junctionLanes, junctions, setApproachLanes, toggleLaneTurn, turnDelta, TURNS,
  type Approach, type Arm, type JunctionLanes, type Turn,
} from '../osm/lanes';
import { compass } from '../osm/turns';
import { turnGroup } from '../map/lanesGeo';
import { TURN_COLORS } from '../map/junctionLayers';
import { currentSelection, useEditor } from '../state/store';
import { useUi } from '../state/ui';
import { removePickedLink } from '../state/laneActions';
import { TURN_GLYPHS } from './LaneTurnsSection';
import { Icon } from './icons';
import type { OsmDoc } from '../osm/types';
import { useSettledDoc } from '../state/settled';
import { JunctionCapacitySection } from './CapacityParts';

/**
 * The junction being edited, on the map next to it: every approach with its number of lanes
 * (− / +) and, for every lane, the directions it may take, in the colours of the ribbons on the
 * map. A click on a ribbon picks that movement here, so it can be forbidden in one step.
 */

const TURN_NAMES: Readonly<Record<Turn, string>> = {
  sharp_left: 'резко налево', left: 'налево', slight_left: 'плавно налево', through: 'прямо',
  slight_right: 'плавно направо', right: 'направо', sharp_right: 'резко направо', reverse: 'разворот',
};

const LEGEND = [['through', 'прямо'], ['right', 'направо'], ['left', 'налево'], ['uturn', 'разворот']] as const;

const streetOf = (doc: OsmDoc, arm: Arm) => doc.ways[arm.wayId]?.tags.name || doc.ways[arm.wayId]?.tags.highway || 'дорога';

/** Turns the junction offers from this approach: one per road you can leave by. */
function offeredTurns(lanes: JunctionLanes, approach: Approach): Turn[] {
  const from = approach.arm;
  return TURNS.filter((t) => lanes.arms.some((to) => to !== from && to.lanesOut > 0 && classifyTurn(turnDelta(from, to)) === t));
}

function ApproachRow({ nodeId, lanes, approach }: { nodeId: string; lanes: JunctionLanes; approach: Approach }) {
  const doc = useSettledDoc();
  const apply = useEditor((s) => s.apply);
  const picked = useUi((s) => s.laneLink);
  const arm = approach.arm;
  const offered = offeredTurns(lanes, approach);
  const count = approach.turns.length;
  const setLanes = (n: number) => apply((d) => setApproachLanes(d, nodeId, arm, n));
  return (
    <div className="jc-approach">
      <div className="jc-approach-head">
        <span className="jc-street" title={streetOf(doc, arm)}>{streetOf(doc, arm)}<em>{compass(arm.bearing)}</em></span>
        <span className="jc-stepper" role="group" aria-label="Полос на въезде">
          <button onClick={() => setLanes(count - 1)} disabled={count <= 1} title="Убрать полосу">−</button>
          <b className="mono">{count}</b>
          <button onClick={() => setLanes(count + 1)} title="Добавить полосу">+</button>
        </span>
      </div>
      <div className="jc-lanes">
        {approach.turns.map((turns, lane) => (
          <div key={lane} className="jc-lane" aria-label={`Полоса ${lane + 1}`}>
            {offered.map((t) => {
              const on = turns.includes(t);
              const isPicked = Boolean(picked && picked.from === armKey(arm) && picked.lane === lane && picked.turn === t);
              return (
                <button
                  key={t} className={`jc-turn${on ? ' on' : ''}${isPicked ? ' picked' : ''}`} aria-pressed={on}
                  style={{ '--turn': TURN_COLORS[turnGroup(t)] } as React.CSSProperties}
                  title={`Полоса ${lane + 1}: ${TURN_NAMES[t]}${on ? ' — запретить' : ' — разрешить'}`}
                  onClick={() => apply((d) => toggleLaneTurn(d, nodeId, arm, lane, t))}
                >{TURN_GLYPHS[t]}</button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function PickedLink() {
  const picked = useUi((s) => s.laneLink);
  if (!picked) return <p className="jc-hint">Клик по ленте на карте выбирает манёвр. Тяните от красной точки въезда к синей точке выезда, чтобы добавить связь.</p>;
  return (
    <div className="jc-picked">
      <span>Полоса {picked.lane + 1}: {TURN_NAMES[picked.turn as Turn] ?? picked.turn}</span>
      <button className="btn btn-sm" onClick={removePickedLink}>Запретить <kbd>Del</kbd></button>
    </div>
  );
}

export function JunctionCard() {
  const doc = useSettledDoc();
  const selection = useEditor((s) => currentSelection(s));
  const select = useEditor((s) => s.select);
  const apply = useEditor((s) => s.apply);
  const nodeId = selection?.type === 'node' ? selection.id : null;
  if (!nodeId || !junctions(doc).includes(nodeId)) return null;
  const lanes = junctionLanes(doc, nodeId);
  if (!lanes.approaches.length) return null;
  const names = [...new Set(lanes.arms.map((a) => doc.ways[a.wayId]?.tags.name).filter(Boolean))].slice(0, 2).join(' × ');
  return (
    <section className="float junction-card" aria-label="Перекрёсток">
      <header className="jc-head">
        <div><span className="micro">Перекрёсток</span><h3>{names || `узел ${nodeId}`}</h3></div>
        <button className="tool" onClick={() => select(null)} title="Закрыть (Esc)"><Icon name="close" /></button>
      </header>
      <ul className="jc-legend">{LEGEND.map(([g, label]) => <li key={g}><i style={{ background: TURN_COLORS[g] }} />{label}</li>)}</ul>
      <div className="jc-body">
        {lanes.approaches.map((a) => <ApproachRow key={armKey(a.arm)} nodeId={nodeId} lanes={lanes} approach={a} />)}
      </div>
      <JunctionCapacitySection nodeId={nodeId} />
      <PickedLink />
      <div className="jc-templates">
        <button className="btn btn-sm" onClick={() => apply((d) => applyJunctionTemplate(d, nodeId, 'usual'))}>Как обычно</button>
        <button className="btn btn-sm" onClick={() => apply((d) => applyJunctionTemplate(d, nodeId, 'strict'))} title="Налево только с левой полосы, направо только с правой">С крайних</button>
        <button className="btn btn-sm" onClick={() => apply((d) => applyJunctionTemplate(d, nodeId, 'free'))}>Все направления</button>
      </div>
    </section>
  );
}
