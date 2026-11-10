import {
  applyJunctionTemplate, armKey, armsAt, classifyTurn, junctionLanes, junctions, setApproachLanes, toggleLaneTurn, turnDelta, TURNS,
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
import { useState } from 'react';
import { SignalPlanSection } from './SignalPlanSection';
import { approachControl } from '../osm/signs';
import { setNodeTags } from '../osm/edit';
import { withTag } from '../osm/tags';

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

type CardTab = 'lanes' | 'signal' | 'capacity' | 'info';
const CARD_TABS: ReadonlyArray<readonly [CardTab, string]> = [['lanes', 'Полосы'], ['signal', 'Светофор'], ['capacity', 'Пропускная'], ['info', 'Сведения']];

/** What controls the junction and what it is made of, at a glance. */
function JunctionInfo({ nodeId }: { nodeId: string }) {
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
function JunctionSignal({ nodeId }: { nodeId: string }) {
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

export function JunctionCard() {
  const doc = useSettledDoc();
  const selection = useEditor((s) => currentSelection(s));
  const apply = useEditor((s) => s.apply);
  const nodeId = selection?.type === 'node' ? selection.id : null;
  const closed = useUi((s) => s.junctionCardClosed);
  const setClosed = useUi((s) => s.setJunctionCardClosed);
  const [tab, setTab] = useState<CardTab>('lanes');
  if (!nodeId || !junctions(doc).includes(nodeId) || closed === nodeId) return null;
  const lanes = junctionLanes(doc, nodeId);
  if (!lanes.approaches.length) return null;
  const names = [...new Set(lanes.arms.map((a) => doc.ways[a.wayId]?.tags.name).filter(Boolean))].slice(0, 2).join(' × ');
  return (
    <section className="float junction-card" aria-label="Перекрёсток">
      <header className="jc-head">
        <div><span className="micro">Перекрёсток</span><h3>{names || `узел ${nodeId}`}</h3></div>
        <button className="tool" onClick={() => setClosed(nodeId)} title="Закрыть карточку (перекрёсток остаётся выбранным)"><Icon name="close" /></button>
      </header>
      <div className="seg seg-wide jc-tabs" role="tablist" aria-label="Разделы перекрёстка">
        {CARD_TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      {tab === 'lanes' && (
        <>
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
        </>
      )}
      {tab === 'signal' && <JunctionSignal nodeId={nodeId} />}
      {tab === 'capacity' && <JunctionCapacitySection nodeId={nodeId} />}
      {tab === 'info' && <JunctionInfo nodeId={nodeId} />}
    </section>
  );
}
