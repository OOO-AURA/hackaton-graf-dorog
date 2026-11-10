import type { OsmNode, OsmWay } from '../osm/types';
import { junctionDelay } from '../sim/overlay';
import { ADAPTIVE_DEFAULTS, PED_SECONDS, useSim, type SignalPlan } from '../sim/store';
import { Section } from './Section';

const FIXED_PLAN: SignalPlan = { mode: 'fixed', cycle: 90, mainShare: 0.6 };
const ADAPTIVE_PLAN: SignalPlan = { mode: 'adaptive', cycle: 90, mainShare: 0.6, ...ADAPTIVE_DEFAULTS };

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="field">
      <span className="micro">{label}</span>
      <input type="number" min={min} max={max} step={1} defaultValue={value} key={value}
        onBlur={(e) => onChange(Math.min(max, Math.max(min, Math.round(Number(e.target.value)) || value)))}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
    </label>
  );
}

/**
 * How the traffic light works in the micro run. Adaptive (the default, SUMO actuated): green
 * stays on while cars keep coming and switches once the flow thins out, so a busy direction is
 * cleared first. Fixed: a set cycle, to check one's own program.
 */
export function SignalPlanSection({ node, ways }: { node: OsmNode; ways: readonly OsmWay[] }) {
  const plan = useSim((s) => s.plans[node.id]);
  const setPlan = useSim((s) => s.setPlan);
  const result = useSim((s) => s.result);
  const baseline = useSim((s) => s.baseline);
  const applied = result?.plans?.find((p) => p.node === node.id);
  const ids = ways.map((w) => w.id);
  const now = junctionDelay(result, ids);
  const before = baseline && baseline !== result ? junctionDelay(baseline, ids) : null;
  const mode = plan?.mode ?? (plan ? 'fixed' : 'adaptive');
  const p = plan ?? ADAPTIVE_PLAN;
  const update = (patch: Partial<SignalPlan>) => setPlan(node.id, { ...p, mode, ...patch });
  return (
    <Section title="Светофор" aside={<span className="mono count">{mode === 'adaptive' ? 'адаптивный' : `${p.cycle} с`}</span>}>
      <div className="seg seg-wide" role="radiogroup" aria-label="Режим светофора">
        <button role="radio" aria-checked={mode === 'adaptive'} className={mode === 'adaptive' ? 'on' : ''}
          onClick={() => setPlan(node.id, plan?.mode === 'adaptive' ? plan : null)}>Адаптивный</button>
        <button role="radio" aria-checked={mode === 'fixed'} className={mode === 'fixed' ? 'on' : ''}
          onClick={() => setPlan(node.id, { ...FIXED_PLAN, ...(plan && plan.mode !== 'adaptive' ? plan : {}), mode: 'fixed' })}>Фиксированный цикл</button>
      </div>
      <div className="signal-sections">
        <span className="micro">Дополнительные секции</span>
        <label className="check" title="Перед основной фазой — отдельная фаза: зелёная стрелка налево горит, встречные стоят">
          <input type="checkbox" checked={Boolean(p.leftArrow)} onChange={(e) => update({ leftArrow: e.target.checked })} /> Стрелка налево: своя фаза поворота
        </label>
        <label className="check" title="Дополнительная секция со стрелкой направо: правый поворот разрешён в каждой зелёной фазе">
          <input type="checkbox" checked={Boolean(p.rightArrow)} onChange={(e) => update({ rightArrow: e.target.checked })} /> Стрелка направо: доп. секция
        </label>
        <label className="check" title="Отдельная фаза для пешеходов: все машины стоят, люди переходят во всех направлениях">
          <input type="checkbox" checked={Boolean(p.pedPhase)} onChange={(e) => update({ pedPhase: e.target.checked })} /> Пешеходная фаза
        </label>
        {p.pedPhase && <NumberField label="Пешеходная фаза, с" value={p.pedSeconds ?? PED_SECONDS} min={5} max={60} onChange={(pedSeconds) => update({ pedSeconds })} />}
        <p className="hint">Секции уходят в программу светофора SUMO при следующем прогоне «Микро». В файле OSM для них нет стандартного тега: это настройки модели.</p>
      </div>
      {mode === 'adaptive' ? (
        <>
          <p className="hint">Зелёный горит, пока к стоп-линии подъезжают машины, и переключается, когда поток редеет. Загруженное направление разгружается первым, пустое не держит перекрёсток.</p>
          {plan ? (
            <>
              <div className="row">
                <NumberField label="Мин. зелёный, с" value={p.minGreen ?? ADAPTIVE_DEFAULTS.minGreen} min={3} max={60} onChange={(minGreen) => update({ minGreen })} />
                <NumberField label="Макс. зелёный, с" value={p.maxGreen ?? ADAPTIVE_DEFAULTS.maxGreen} min={10} max={120} onChange={(maxGreen) => update({ maxGreen })} />
              </div>
              <NumberField label="Разрыв в потоке, с" value={p.maxGap ?? ADAPTIVE_DEFAULTS.maxGap} min={1} max={10} onChange={(maxGap) => update({ maxGap })} />
              <p className="hint">Если между машинами дольше «разрыва», зелёный заканчивается раньше максимума. Уходит в SUMO как светофор типа actuated.</p>
              <button className="btn" onClick={() => setPlan(node.id, null)}>Как у SUMO по умолчанию</button>
            </>
          ) : (
            <button className="btn" onClick={() => setPlan(node.id, ADAPTIVE_PLAN)}>Настроить</button>
          )}
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
