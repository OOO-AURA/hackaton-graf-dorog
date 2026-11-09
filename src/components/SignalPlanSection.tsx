import type { OsmNode, OsmWay } from '../osm/types';
import { junctionDelay } from '../sim/overlay';
import { useSim, type SignalPlan } from '../sim/store';
import { Section } from './Section';

const DEFAULT_PLAN: SignalPlan = { cycle: 90, mainShare: 0.6 };

/** Signal timing for the micro run and the junction's delay before and after the change. */
export function SignalPlanSection({ node, ways }: { node: OsmNode; ways: readonly OsmWay[] }) {
  const plan = useSim((s) => s.plans[node.id]);
  const setPlan = useSim((s) => s.setPlan);
  const result = useSim((s) => s.result);
  const baseline = useSim((s) => s.baseline);
  const applied = result?.plans?.find((p) => p.node === node.id);
  const ids = ways.map((w) => w.id);
  const now = junctionDelay(result, ids);
  const before = baseline && baseline !== result ? junctionDelay(baseline, ids) : null;
  const p = plan ?? DEFAULT_PLAN;
  const update = (patch: Partial<SignalPlan>) => setPlan(node.id, { ...p, ...patch });
  return (
    <Section title="Цикл светофора" aside={plan ? <span className="mono count">{plan.cycle} с</span> : undefined}>
      {!plan ? (
        <>
          <p className="hint">Сейчас SUMO сам подбирает фазы (адаптивный светофор). Задайте цикл, чтобы проверить свою программу.</p>
          <button className="btn" onClick={() => setPlan(node.id, DEFAULT_PLAN)}>Задать цикл</button>
        </>
      ) : (
        <>
          <label className="field">
            <span className="micro">Длительность цикла, с</span>
            <input type="number" min={20} max={240} step={5} defaultValue={p.cycle} key={p.cycle}
              onBlur={(e) => update({ cycle: Math.min(240, Math.max(20, Math.round(Number(e.target.value)) || 90)) })}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
          </label>
          <label className="field">
            <span className="micro">Зелёный главному направлению: {Math.round(p.mainShare * 100)}%</span>
            <input type="range" min={0.2} max={0.8} step={0.05} value={p.mainShare} onChange={(e) => update({ mainShare: Number(e.target.value) })} />
          </label>
          <p className="hint">Жёлтый и общий красный остаются как есть, остаток цикла делится между зелёными фазами. Главными считаются фазы с наибольшим числом зелёных потоков. Программа уходит в SUMO как tlLogic при следующем пересчёте.</p>
          <button className="btn" onClick={() => setPlan(node.id, null)}>Вернуть адаптивный</button>
        </>
      )}
      {applied && <p className="hint">В последнем прогоне: цикл {applied.cycle_s.toFixed(0)} с.</p>}
      {plan && result && !applied && <p className="hint">В последнем прогоне программы не было: пересчитайте или проверьте, что SUMO нашёл здесь светофор.</p>}
      {now && (
        <dl className="facts">
          <dt>Задержка на подходах</dt>
          <dd>
            {now.delay.toFixed(1)} с
            {before && <span className={`kpi-delta ${now.delay < before.delay ? 'good' : 'bad'}`}> {now.delay > before.delay ? '+' : '−'}{Math.abs(now.delay - before.delay).toFixed(1)}</span>}
          </dd>
          <dt>Проехало ТС</dt><dd>{now.entered.toFixed(0)}</dd>
        </dl>
      )}
      {now && !before && <p className="hint">Для сравнения «до/после» запомните прогон как базовый в панели Микро, поменяйте цикл и пересчитайте.</p>}
    </Section>
  );
}
