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
import { SignalEditor } from './SignalPlanSection';
import { approachControl, approachCrossing, approachSign, approachSpeed, GAPS, gapCapacity, mainRoadAt, setApproachCrossing, setApproachSign, setApproachSpeed, type ApproachSign } from '../osm/signs';
import { armLabel, junctionTurns, setTurnAllowed, type TurnKind } from '../osm/turns';
import { useGaps } from '../state/gaps';
import { useApproachFlows } from './SignalPlanSection';

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

/** Light of the junction: put it, take it away, its phases and every setting (SignalPlanSection.tsx). */
export function JunctionSignal({ nodeId }: { nodeId: string }) {
  return <SignalEditor nodeId={nodeId} />;
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

/** Movements banned from an approach, from the turn table (relations `type=restriction`). */
const BAN_SIGN: Readonly<Record<TurnKind, string>> = { left: '3.18.2', right: '3.18.1', uturn: '3.19', straight: '' };
const BAN_NAME: Readonly<Record<TurnKind, string>> = { left: 'налево', right: 'направо', uturn: 'разворот', straight: 'прямо' };

/**
 * Every sign of every approach, as drivers coming in see them: priority (2.1, 2.4, 2.5), speed
 * limit (3.24), banned turns (3.18.1, 3.18.2, 3.19), directions by lane (5.15.1, from the lanes),
 * a pedestrian crossing (5.19), and for an approach that gives way the gap times its capacity
 * comes from.
 */
export function JunctionSigns({ nodeId }: { nodeId: string }) {
  const doc = useSettledDoc();
  const apply = useEditor((s) => s.apply);
  const gaps = useGaps((s) => s.gaps[nodeId] ?? {});
  const setGaps = useGaps((s) => s.set);
  const flows = useApproachFlows(nodeId);
  const arms = armsAt(doc, nodeId).filter((a) => a.lanesIn > 0);
  const lanes = junctionLanes(doc, nodeId);
  const turns = junctionTurns(doc, nodeId);
  const signal = doc.nodes[nodeId]?.tags.highway === 'traffic_signals';
  const main = mainRoadAt(doc, nodeId);
  // The turn table names its arms on its own; they are matched by way and direction.
  const turnArm = (arm: Arm) => turns.map((t) => t.from).find((f) => f.wayId === arm.wayId && Math.abs(((f.bearing - arm.bearing + 540) % 360) - 180) < 1);
  return (
    <div className="jc-signs">
      {signal && <p className="jc-hint">Перекрёсток со светофором: знаки приоритета действуют, только когда он выключен. Остальные знаки работают всегда.</p>}
      {main.turns && <p className="jc-note"><b>8.13</b> Главная дорога здесь поворачивает: под знаками 2.1 и 2.4 нужна табличка «Направление главной дороги».</p>}
      {main.arms.length > 2 && <p className="jc-note bad">Главной отмечено больше двух въездов: так быть не может, оставьте два.</p>}
      {arms.map((arm) => {
        const key = armKey(arm);
        const now = approachSign(doc, nodeId, arm);
        const speed = approachSpeed(doc, arm);
        const from = turnArm(arm);
        const own = from ? turns.filter((t) => t.from.key === from.key && t.kind !== 'straight') : [];
        const approach = lanes.approaches.find((a) => armKey(a.arm) === key);
        const crossing = approachCrossing(doc, nodeId, arm);
        const yields = now === 'give_way' || now === 'stop';
        const g = gaps[key] ?? GAPS[now === 'stop' ? 'stop' : 'give_way'];
        // The flow it has to find gaps in: the main road's approaches, or all the others when none is marked.
        const mains = arms.filter((a) => a !== arm && approachSign(doc, nodeId, a) === 'main');
        const mainFlow = flows ? (mains.length ? mains : arms.filter((a) => a !== arm)).reduce((s, a) => s + flows(armKey(a)), 0) : 600;
        return (
          <div key={key} className="jc-sign-card">
            <div className="jc-sign-row">
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
            <div className="jc-sign-grid">
              <label className="field">
                <span className="micro">3.24 Ограничение, км/ч</span>
                <input type="number" min={5} max={130} step={5} placeholder="нет" defaultValue={speed ?? ''} key={speed ?? 'none'}
                  onBlur={(e) => { const v = Number.parseFloat(e.target.value); apply((d) => setApproachSpeed(d, arm, Number.isFinite(v) && v > 0 ? v : null)); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
              </label>
              <label className="check jc-sign-check">
                <input type="checkbox" checked={crossing} onChange={(e) => apply((d) => setApproachCrossing(d, nodeId, arm, e.target.checked))} />
                <span><b>5.19</b> Пешеходный переход</span>
              </label>
            </div>
            {own.length > 0 && (
              <div className="jc-bans">
                <span className="micro">Запреты поворотов</span>
                {own.map((t) => (
                  <button key={t.to.key} className={`jc-ban${t.allowed ? '' : ' on'}`} aria-pressed={!t.allowed}
                    title={t.allowed ? `Запретить: ${BAN_NAME[t.kind]} на ${armLabel(t.to)}` : `Разрешить: ${BAN_NAME[t.kind]} на ${armLabel(t.to)}`}
                    onClick={() => apply((d) => setTurnAllowed(d, nodeId, t.from, t.to, !t.allowed))}>
                    {!t.allowed && <i>{BAN_SIGN[t.kind]}</i>} {BAN_NAME[t.kind]} → {armLabel(t.to)}
                  </button>
                ))}
              </div>
            )}
            {approach && approach.turns.length > 1 && (
              <div className="jc-lane-signs" title="5.15.1: направления по полосам, из настроек полос">
                <span className="micro">5.15.1 По полосам</span>
                <span className="jc-lane-sign">{approach.turns.map((ts, i) => <b key={i}>{ts.map((t) => TURN_GLYPHS[t]).join('') || '·'}</b>)}</span>
              </div>
            )}
            {yields && (
              <div className="jc-gaps">
                <label className="field"><span className="micro">Критический интервал, с</span>
                  <input type="number" min={2} max={10} step={0.1} defaultValue={g.tc} key={`tc${g.tc}`}
                    onBlur={(e) => setGaps(nodeId, key, { tc: Number(e.target.value) || g.tc, tf: g.tf })} /></label>
                <label className="field"><span className="micro">Интервал следования, с</span>
                  <input type="number" min={1} max={6} step={0.1} defaultValue={g.tf} key={`tf${g.tf}`}
                    onBlur={(e) => setGaps(nodeId, key, { tc: g.tc, tf: Number(e.target.value) || g.tf })} /></label>
                <span className="jc-gap-cap">≈ <b className="mono">{Math.round(gapCapacity(mainFlow, g.tc, g.tf))}</b> авт/ч на полосу при потоке главной {Math.round(mainFlow)} авт/ч{flows ? '' : ' (условно, без расчёта потоков)'}</span>
              </div>
            )}
          </div>
        );
      })}
      <p className="jc-hint">Без знаков на равнозначном перекрёстке действует правило правой руки. «Главная дорога» и ограничение скорости ставятся на всю дорогу (теги <code>priority_road</code>, <code>maxspeed</code>).</p>
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
