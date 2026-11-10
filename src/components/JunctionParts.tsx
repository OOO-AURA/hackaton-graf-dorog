import {
  applyJunctionTemplate, armKey, armsAt, classifyTurn, junctionLanes, setApproachLanes, toggleLaneTurn, turnDelta, TURNS,
  type Approach, type Arm, type JunctionLanes, type Turn,
} from '../osm/lanes';
import { compass } from '../osm/turns';
import { turnGroup } from '../map/lanesGeo';
import { TURN_COLORS } from '../map/junctionLayers';
import { useEditor } from '../state/store';
import { useUi } from '../state/ui';
import { removePickedLink } from '../state/laneActions';
import { TURN_GLYPHS } from './LaneTurnsSection';
import type { OsmDoc } from '../osm/types';
import { useSettledDoc } from '../state/settled';
import { SignalPlanSection } from './SignalPlanSection';
import { approachControl, approachSign, setApproachSign, type ApproachSign } from '../osm/signs';
import { setNodeTags } from '../osm/edit';
import { withTag } from '../osm/tags';

/**
 * Parts of a junction's editing, shared by the node inspector and the junction editor window:
 * every approach with its number of lanes (− / +) and, for every lane, the directions it may
 * take, in the colours of the ribbons on the map (a click on a ribbon picks that movement here,
 * so it can be forbidden in one step); the priority sign of every approach; the traffic light;
 * capacity; what the junction is made of.
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

/** What controls the junction and what it is made of, at a glance. */
export function JunctionInfo({ nodeId }: { nodeId: string }) {
  const doc = useSettledDoc();
  const node = doc.nodes[nodeId];
  const arms = armsAt(doc, nodeId);
  const controls = arms.map((a) => approachControl(doc, nodeId, a));
  const control = controls.includes('signal') ? 'светофор' : controls.some((c) => c === 'give_way' || c === 'stop') ? 'знаки приоритета' : 'равнозначный, правило правой руки';
  const ways = [...new Set(arms.map((a) => a.wayId))].map((id) => doc.ways[id]);
  const crossings = ways.flatMap((w) => w.refs).filter((r, i, all) => all.indexOf(r) === i && doc.nodes[r]?.tags.highway === 'crossing').length;
  return (
    <dl className="facts">
      <dt>Регулирование</dt><dd>{control}</dd>
      <dt>Дорог / въездов</dt><dd className="mono">{ways.length} / {arms.filter((a) => a.lanesIn > 0).length}</dd>
      <dt>Полос на въездах</dt><dd className="mono">{arms.reduce((s, a) => s + a.lanesIn, 0)}</dd>
      <dt>Переходов рядом</dt><dd className="mono">{crossings}</dd>
      <dt>Улицы</dt><dd>{[...new Set(ways.map((w) => w.tags.name || w.tags.highway))].join(', ')}</dd>
      <dt>Координаты</dt><dd className="mono">{node.lat.toFixed(6)}, {node.lon.toFixed(6)}</dd>
    </dl>
  );
}

/** Light of the junction: its plan and extra sections, or a button to put one. */
export function JunctionSignal({ nodeId }: { nodeId: string }) {
  const doc = useSettledDoc();
  const apply = useEditor((s) => s.apply);
  const node = doc.nodes[nodeId];
  const ways = armsAt(doc, nodeId).map((a) => doc.ways[a.wayId]);
  if (node.tags.highway !== 'traffic_signals') {
    return (
      <div className="jc-signal-empty">
        <p className="jc-hint">Светофора здесь нет.</p>
        <button className="btn btn-sm" onClick={() => apply((d) => setNodeTags(d, nodeId, withTag(d.nodes[nodeId].tags, 'highway', 'traffic_signals')))}>Поставить светофор</button>
      </div>
    );
  }
  return <SignalPlanSection node={node} ways={ways} />;
}

/** Name of a junction from its streets, like "Лермонтова × Игошина". */
export function junctionName(doc: OsmDoc, nodeId: string): string {
  const names = [...new Set(armsAt(doc, nodeId).map((a) => doc.ways[a.wayId]?.tags.name).filter(Boolean))].slice(0, 2).join(' × ');
  return names || `узел ${nodeId}`;
}

/** Lanes of every approach and where they may go, with the templates. */
export function JunctionLanes({ nodeId }: { nodeId: string }) {
  const doc = useSettledDoc();
  const apply = useEditor((s) => s.apply);
  const lanes = junctionLanes(doc, nodeId);
  if (!lanes.approaches.length) return <p className="jc-hint">На этот перекрёсток никто не въезжает.</p>;
  return (
    <div className="jc-lanes-part">
      <ul className="jc-legend">{LEGEND.map(([g, label]) => <li key={g}><i style={{ background: TURN_COLORS[g] }} />{label}</li>)}</ul>
      <div className="jc-body">
        {lanes.approaches.map((a) => <ApproachRow key={armKey(a.arm)} nodeId={nodeId} lanes={lanes} approach={a} />)}
      </div>
      <PickedLink />
      <div className="jc-templates">
        <button className="btn btn-sm" onClick={() => apply((d) => applyJunctionTemplate(d, nodeId, 'usual'))}>Как обычно</button>
        <button className="btn btn-sm" onClick={() => apply((d) => applyJunctionTemplate(d, nodeId, 'strict'))} title="Налево только с левой полосы, направо только с правой">С крайних</button>
        <button className="btn btn-sm" onClick={() => apply((d) => applyJunctionTemplate(d, nodeId, 'free'))}>Все направления</button>
      </div>
    </div>
  );
}

export const SIGN_OPTIONS: ReadonlyArray<readonly [ApproachSign, string]> = [
  ['none', 'Без знака'], ['main', 'Главная дорога'], ['give_way', 'Уступи дорогу'], ['stop', 'STOP'],
];

/** The priority sign of every approach, as drivers coming in see it. */
export function JunctionSigns({ nodeId }: { nodeId: string }) {
  const doc = useSettledDoc();
  const apply = useEditor((s) => s.apply);
  const arms = armsAt(doc, nodeId).filter((a) => a.lanesIn > 0);
  if (doc.nodes[nodeId]?.tags.highway === 'traffic_signals') return <p className="jc-hint">Перекрёсток регулируется светофором: знаки приоритета на нём не действуют.</p>;
  return (
    <div className="jc-signs">
      {arms.map((arm) => {
        const now = approachSign(doc, nodeId, arm);
        return (
          <div key={armKey(arm)} className="jc-sign-row">
            <span className="jc-street" title={streetOf(doc, arm)}>{streetOf(doc, arm)}<em>{compass(arm.bearing)}</em></span>
            <div className="seg jc-sign-seg" role="radiogroup" aria-label={`Знак: ${streetOf(doc, arm)}`}>
              {SIGN_OPTIONS.map(([v, label]) => (
                <button key={v} role="radio" aria-checked={now === v} className={now === v ? 'on' : ''} title={label}
                  onClick={() => apply((d) => setApproachSign(d, nodeId, arm, v))}>
                  <SignGlyph sign={v} />
                </button>
              ))}
            </div>
          </div>
        );
      })}
      <p className="jc-hint">Без знаков на равнозначном перекрёстке действует правило правой руки. «Главная дорога» ставится на всю улицу.</p>
    </div>
  );
}

/** Small pictures of the signs 2.1, 2.4 and 2.5, and a dash for no sign. */
export function SignGlyph({ sign, size = 18 }: { sign: ApproachSign; size?: number }) {
  if (sign === 'main') {
    return <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="4" width="12" height="12" transform="rotate(45 10 10)" fill="#fff" stroke="#222" strokeWidth="1" /><rect x="6.5" y="6.5" width="7" height="7" transform="rotate(45 10 10)" fill="#F2C230" /></svg>;
  }
  if (sign === 'give_way') {
    return <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true"><path d="M2 3h16L10 18z" fill="#fff" stroke="#D3302A" strokeWidth="2.4" strokeLinejoin="round" /></svg>;
  }
  if (sign === 'stop') {
    return <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true"><path d="M6.5 1.5h7l5 5v7l-5 5h-7l-5-5v-7z" fill="#D3302A" /><text x="10" y="12.6" textAnchor="middle" fontSize="5.6" fontWeight="700" fill="#fff" fontFamily="sans-serif">STOP</text></svg>;
  }
  return <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
}
