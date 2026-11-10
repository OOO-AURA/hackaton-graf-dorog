import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { OsmNode, OsmWay } from '../osm/types';
import { junctionDelay } from '../sim/overlay';
import { ADAPTIVE_DEFAULTS, useSim, type SignalPlan } from '../sim/store';
import { useMacro } from '../macro/store';
import { useEditor } from '../state/store';
import { useSettledDoc } from '../state/settled';
import { setNodeTags } from '../osm/edit';
import { withTag } from '../osm/tags';
import { armKey, type Arm } from '../osm/lanes';
import { compass } from '../osm/turns';
import {
  ALL_RED, approachCapacity, approachesOf, approachTimeline, cycleOf, defaultPhases, LOST_TIME, MIN_GREEN, MOVE_NAMES, MOVE_ORDER, PED_SPEED,
  pedGreen, SAT_FLOW, webster, YELLOW, type Move, type SignalPhase,
} from '../osm/signalPhases';
import { Section } from './Section';

/**
 * The traffic light of a junction in full: put it or take it away, fixed or adaptive, its phases
 * as coloured bars over the cycle (borders between phases are dragged to give one more green),
 * every phase with its green, yellow and all-red and how each approach moves, the offset for a
 * green wave, saturation flow, lost time and walking speed, a cycle by Webster's method from the
 * macro flows, and capacity of every approach. Goes to SUMO with the next micro run.
 */

const LIGHT_COLORS = { green: '#33B864', arrow: '#7FDB8E', yellow: '#F2C230', red: '#D9443A' } as const;
const MOVE_SHORT: Readonly<Record<Move, string>> = { off: '—', go: '↑↰↱', noleft: '↑↱', left: '↰' };

function Num({ label, value, min, max, step = 1, onChange, unit }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <label className="field sig-num">
      <span className="micro">{label}{unit && <em>, {unit}</em>}</span>
      <input type="number" min={min} max={max} step={step} defaultValue={value} key={value}
        onBlur={(e) => { const v = Number(e.target.value.replace(',', '.')); onChange(Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : value); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
    </label>
  );
}

const streetOf = (doc: ReturnType<typeof useSettledDoc>, arm: Arm) => doc.ways[arm.wayId]?.tags.name || doc.ways[arm.wayId]?.tags.highway || 'дорога';

/** Vehicles an hour coming in along each approach, from the last macro run: flows of the way's link that ends at the junction. */
function useApproachFlows(nodeId: string): ((key: string) => number) | null {
  const result = useMacro((s) => s.result);
  const doc = useSettledDoc();
  return useMemo(() => {
    if (!result) return null;
    const node = doc.nodes[nodeId];
    const by = new Map<string, number>();
    for (const f of result.flows.features as Array<{ geometry: { coordinates: number[][] }; properties: { kind: string; way?: string; v?: number } }>) {
      const p = f.properties;
      if (p.kind !== 'flow' || !p.way || !p.v) continue;
      const end = f.geometry.coordinates[f.geometry.coordinates.length - 1];
      if (Math.abs(end[0] - node.lon) > 1e-5 || Math.abs(end[1] - node.lat) > 1e-5) continue;
      const w = doc.ways[p.way];
      if (!w) continue;
      // Coming in along the way's direction, the road leaves the junction against it.
      const atEnd = w.refs[w.refs.length - 1] === nodeId;
      const key = `${p.way}:${atEnd ? -1 : 1}`;
      by.set(key, (by.get(key) ?? 0) + p.v);
    }
    return by.size ? (key: string) => by.get(key) ?? 0 : null;
  }, [result, doc, nodeId]);
}

/** The cycle as bars: a strip of the phases on top, a bar of lights for every approach under it. */
function Timeline({ phases, arms, names, onGreen }: { phases: readonly SignalPhase[]; arms: readonly Arm[]; names: (a: Arm) => string; onGreen: (i: number, green: number) => void }) {
  const cycle = cycleOf(phases) || 1;
  const bar = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ i: number; x0: number; g0: number } | null>(null);
  const pct = (t: number) => `${(t / cycle) * 100}%`;
  let t = 0;
  const starts = phases.map((p) => { const s = t; t += p.green + p.yellow + p.allRed; return s; });
  const onMove = (e: ReactPointerEvent) => {
    if (!drag || !bar.current) return;
    const w = bar.current.getBoundingClientRect().width;
    const dt = ((e.clientX - drag.x0) / w) * cycle;
    onGreen(drag.i, Math.max(phases[drag.i].ped ? 5 : MIN_GREEN, Math.round(drag.g0 + dt)));
  };
  // Marks every 10 s, numbers every 30 s, so a long cycle stays readable in a narrow panel.
  const ticks = Array.from({ length: Math.floor(cycle / 10) + 1 }, (_, k) => k * 10).filter((s) => cycle - s > 8);
  return (
    <div className="sig-timeline" onPointerMove={onMove} onPointerUp={() => setDrag(null)} onPointerLeave={() => setDrag(null)}>
      <div className="sig-row sig-phases">
        <span className="sig-name micro">Фазы</span>
        <div className="sig-bar" ref={bar}>
          {phases.map((p, i) => (
            <div key={i} className={`sig-phase${p.ped ? ' ped' : ''}`} style={{ left: pct(starts[i]), width: pct(p.green + p.yellow + p.allRed) }}>
              <span>Ф{i + 1}{p.ped ? ' 🚶' : ''} · {p.green}</span>
              <i className="sig-handle" style={{ left: pct(p.green) }} title="Тяните: зелёный этой фазы"
                onPointerDown={(e) => { e.preventDefault(); (e.currentTarget as Element).setPointerCapture?.(e.pointerId); setDrag({ i, x0: e.clientX, g0: p.green }); }} />
            </div>
          ))}
        </div>
      </div>
      {arms.map((a) => (
        <div key={armKey(a)} className="sig-row">
          <span className="sig-name" title={names(a)}>{names(a)}<em>{compass(a.bearing)}</em></span>
          <div className="sig-bar">
            {approachTimeline(phases, armKey(a)).map((r, k) => (
              <i key={k} className={`sig-light ${r.light}`} style={{ left: pct(r.from), width: pct(r.to - r.from), background: LIGHT_COLORS[r.light] }} />
            ))}
          </div>
        </div>
      ))}
      <div className="sig-row sig-ticks">
        <span className="sig-name" />
        <div className="sig-bar">{ticks.map((s) => <span key={s} className={s % 30 ? 'minor' : ''} style={{ left: pct(s) }}>{s % 30 ? '' : s}</span>)}<span className="end">{Math.round(cycle)} с</span></div>
      </div>
    </div>
  );
}

/** Settings of the light at `nodeId`, for the inspector and the junction editor. */
export function SignalEditor({ nodeId }: { nodeId: string }) {
  const doc = useSettledDoc();
  const apply = useEditor((s) => s.apply);
  const node = doc.nodes[nodeId];
  const plan = useSim((s) => s.plans[nodeId]);
  const setPlan = useSim((s) => s.setPlan);
  const result = useSim((s) => s.result);
  const baseline = useSim((s) => s.baseline);
  const flows = useApproachFlows(nodeId);
  const arms = useMemo(() => approachesOf(doc, nodeId), [doc, nodeId]);
  const names = (a: Arm) => streetOf(doc, a);
  if (!node) return null;
  const isSignal = node.tags.highway === 'traffic_signals';
  if (!isSignal) {
    return (
      <div className="sig-empty">
        <p className="jc-hint">Светофора здесь нет.</p>
        <button className="btn btn-ink" onClick={() => apply((d) => setNodeTags(d, nodeId, withTag(d.nodes[nodeId].tags, 'highway', 'traffic_signals')))}>Поставить светофор</button>
      </div>
    );
  }
  const mode = plan?.mode ?? 'adaptive';
  const phases = plan?.phases?.length ? plan.phases : defaultPhases(doc, nodeId, { leftArrow: plan?.leftArrow, ped: plan?.pedPhase, cycle: plan?.cycle });
  const base: SignalPlan = plan ?? { mode: 'adaptive', cycle: 90, mainShare: 0.6, ...ADAPTIVE_DEFAULTS };
  const save = (patch: Partial<SignalPlan>) => setPlan(nodeId, { ...base, mode, phases, ...patch });
  const setPhases = (next: SignalPhase[]) => save({ phases: next, cycle: cycleOf(next) });
  const patchPhase = (i: number, patch: Partial<SignalPhase>) => setPhases(phases.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  const satFlow = plan?.satFlow ?? SAT_FLOW;
  const lost = plan?.lostTime ?? LOST_TIME;
  const pedSpeed = plan?.pedSpeed ?? PED_SPEED;
  const cycle = cycleOf(phases);
  const remove = () => {
    apply((d) => setNodeTags(d, nodeId, withTag(withTag(d.nodes[nodeId].tags, 'highway', null), 'traffic_signals', null)));
    setPlan(nodeId, null);
  };
  const widest = Math.max(...arms.map((a) => (a.lanesIn + a.lanesOut) * 3.5), 7);
  const best = flows ? webster(phases, arms, flows, satFlow, lost) : null;
  const applied = result?.plans?.find((p) => p.node === nodeId);
  const ways = [...new Set(arms.map((a) => a.wayId))].map((id) => doc.ways[id]).filter(Boolean);
  const delay = junctionDelay(result, ways.map((w) => w.id));
  const before = baseline && baseline !== result ? junctionDelay(baseline, ways.map((w) => w.id)) : null;
  return (
    <div className="sig-editor">
      <div className="sig-top">
        <div className="seg" role="radiogroup" aria-label="Режим светофора">
          <button role="radio" aria-checked={mode === 'fixed'} className={mode === 'fixed' ? 'on' : ''} onClick={() => save({ mode: 'fixed' })}>Фиксированный</button>
          <button role="radio" aria-checked={mode === 'adaptive'} className={mode === 'adaptive' ? 'on' : ''} onClick={() => save({ mode: 'adaptive' })}>Адаптивный</button>
        </div>
        <span className="mono sig-cycle">цикл {Math.round(cycle)} с</span>
        <button className="btn btn-sm btn-danger" onClick={remove}>Убрать светофор</button>
      </div>

      <Timeline phases={phases} arms={arms} names={names} onGreen={(i, green) => patchPhase(i, { green })} />
      <ul className="sig-legend">
        <li><i style={{ background: LIGHT_COLORS.green }} />зелёный</li><li><i style={{ background: LIGHT_COLORS.arrow }} />стрелка налево</li>
        <li><i style={{ background: LIGHT_COLORS.yellow }} />жёлтый</li><li><i style={{ background: LIGHT_COLORS.red }} />красный</li>
      </ul>

      <div className="sig-phase-list">
        {phases.map((p, i) => (
          <div key={i} className="sig-phase-card">
            <div className="sig-phase-head">
              <b>Фаза {i + 1}</b>
              <label className="check"><input type="checkbox" checked={Boolean(p.ped)} onChange={(e) => patchPhase(i, { ped: e.target.checked, green: e.target.checked ? Math.max(p.green, pedGreen(widest, pedSpeed)) : p.green })} /> только пешеходы</label>
              <button className="icon-btn" disabled={phases.length < 2} onClick={() => setPhases(phases.filter((_, k) => k !== i))} title="Удалить фазу" aria-label={`Удалить фазу ${i + 1}`}>✕</button>
            </div>
            <div className="sig-times">
              <Num label="Зелёный" unit="с" value={p.green} min={p.ped ? 5 : MIN_GREEN} max={180} onChange={(green) => patchPhase(i, { green })} />
              <Num label="Жёлтый" unit="с" value={p.yellow} min={0} max={6} onChange={(yellow) => patchPhase(i, { yellow })} />
              <Num label="Кр. общий" unit="с" value={p.allRed} min={0} max={10} onChange={(allRed) => patchPhase(i, { allRed })} />
            </div>
            {!p.ped && (
              <div className="sig-moves">
                {arms.map((a) => {
                  const m = p.moves[armKey(a)] ?? 'off';
                  return (
                    <button key={armKey(a)} className={`sig-move ${m}`} title={`${names(a)}: ${MOVE_NAMES[m]}. Клик меняет`}
                      onClick={() => patchPhase(i, { moves: { ...p.moves, [armKey(a)]: MOVE_ORDER[(MOVE_ORDER.indexOf(m) + 1) % MOVE_ORDER.length] } })}>
                      <span className="sig-move-name">{names(a)} <em>{compass(a.bearing)}</em></span><b>{MOVE_SHORT[m]}</b>
                    </button>
                  );
                })}
              </div>
            )}
            {p.ped && <p className="jc-hint">Все машины стоят, пешеходы переходят по всем переходам. Нужно не меньше {pedGreen(widest, pedSpeed)} с: 7 с на старт и {widest} м со скоростью {pedSpeed} м/с.</p>}
          </div>
        ))}
        <div className="buttons">
          <button className="btn btn-sm" onClick={() => setPhases([...phases, { green: 20, yellow: YELLOW, allRed: ALL_RED, moves: {} }])}>+ Фаза</button>
          <button className="btn btn-sm" onClick={() => setPhases(defaultPhases(doc, nodeId, { cycle }))}>По осям</button>
          <button className="btn btn-sm" onClick={() => setPhases(defaultPhases(doc, nodeId, { leftArrow: true, cycle }))}>Со стрелками налево</button>
          <button className="btn btn-sm" onClick={() => setPhases([...phases.filter((p) => !p.ped), { green: pedGreen(widest, pedSpeed), yellow: 0, allRed: ALL_RED, moves: {}, ped: true }])}>+ Пешеходная фаза</button>
        </div>
      </div>

      <h4 className="micro sig-sub">Параметры</h4>
      <div className="sig-params">
        <Num label="Сдвиг цикла" unit="с" value={plan?.offset ?? 0} min={0} max={Math.max(0, Math.round(cycle) - 1)} onChange={(offset) => save({ offset })} />
        <Num label="Поток насыщения" unit="авт/ч на полосу" value={satFlow} min={600} max={2400} step={50} onChange={(v) => save({ satFlow: v })} />
        <Num label="Потерянное время фазы" unit="с" value={lost} min={0} max={10} onChange={(v) => save({ lostTime: v })} />
        <Num label="Скорость пешехода" unit="м/с" value={pedSpeed} min={0.6} max={2} step={0.1} onChange={(v) => save({ pedSpeed: v })} />
        {mode === 'adaptive' && (
          <>
            <Num label="Мин. зелёный" unit="с" value={plan?.minGreen ?? ADAPTIVE_DEFAULTS.minGreen} min={3} max={60} onChange={(minGreen) => save({ minGreen })} />
            <Num label="Макс. зелёный" unit="с" value={plan?.maxGreen ?? ADAPTIVE_DEFAULTS.maxGreen} min={10} max={120} onChange={(maxGreen) => save({ maxGreen })} />
            <Num label="Разрыв в потоке" unit="с" value={plan?.maxGap ?? ADAPTIVE_DEFAULTS.maxGap} min={1} max={10} step={0.5} onChange={(maxGap) => save({ maxGap })} />
          </>
        )}
      </div>
      <p className="hint">{mode === 'adaptive'
        ? 'Адаптивный: каждая фаза горит от мин. до макс. зелёного и заканчивается, когда между машинами разрыв дольше заданного (SUMO actuated). Длины фаз выше — стартовые.'
        : 'Фиксированный: фазы горят ровно столько, сколько задано. Сдвиг нужен для «зелёной волны» с соседним светофором.'}</p>

      <h4 className="micro sig-sub">Расчёт</h4>
      <table className="sig-cap">
        <thead><tr><th>Въезд</th><th>Полос</th><th>Зелёный</th><th>Пропуск., авт/ч</th>{flows && <th>Поток</th>}{flows && <th>V/C</th>}</tr></thead>
        <tbody>
          {arms.map((a) => {
            const cap = approachCapacity(phases, a, satFlow);
            const q = flows?.(armKey(a)) ?? 0;
            const vc = cap ? q / cap : 0;
            return (
              <tr key={armKey(a)}>
                <td>{names(a)} <em>{compass(a.bearing)}</em></td><td className="mono">{a.lanesIn}</td>
                <td className="mono">{Math.round((phases.reduce((s, p) => s + (!p.ped && (p.moves[armKey(a)] ?? 'off') !== 'off' ? p.green : 0), 0) / (cycle || 1)) * 100)}%</td>
                <td className="mono">{Math.round(cap)}</td>
                {flows && <td className="mono">{Math.round(q)}</td>}
                {flows && <td className={`mono ${vc > 1 ? 'bad' : vc > 0.85 ? 'warn' : ''}`}>{vc.toFixed(2)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      {best
        ? <button className="btn btn-sm" onClick={() => setPhases(best.phases)} title={`Y = ${best.y.toFixed(2)}`}>Цикл по Вебстеру: {best.cycle} с</button>
        : <p className="hint">{flows ? 'По Вебстеру не считается: перекрёсток перегружен (Y ≥ 0,95) или потоков на въездах нет.' : 'Цикл по Вебстеру считается по потокам: сначала посчитайте их на шаге «Макро».'}</p>}
      {applied && <p className="hint">В последнем прогоне SUMO: цикл {applied.cycle_s.toFixed(0)} с.</p>}
      {delay && (
        <dl className="facts">
          <dt>Задержка на подходах</dt>
          <dd>{delay.delay.toFixed(1)} с{before && <span className={`kpi-delta ${delay.delay < before.delay ? 'good' : 'bad'}`}> {delay.delay > before.delay ? '+' : '−'}{Math.abs(delay.delay - before.delay).toFixed(1)}</span>}</dd>
          <dt>Проехало ТС</dt><dd>{delay.entered.toFixed(0)}</dd>
        </dl>
      )}
      <p className="hint">Программа уходит в SUMO при следующем прогоне «Микро». В OSM для неё нет стандартных тегов: она хранится рядом с файлом как настройка модели.</p>
    </div>
  );
}

/** The light in the node inspector. */
export function SignalPlanSection({ node }: { node: OsmNode; ways?: readonly OsmWay[] }) {
  const plan = useSim((s) => s.plans[node.id]);
  return (
    <Section title="Светофор" aside={<span className="mono count">{plan?.mode === 'fixed' ? 'фиксированный' : 'адаптивный'}</span>}>
      <SignalEditor nodeId={node.id} />
    </Section>
  );
}
