import { useSim } from '../../sim/store';
import type { DemandKind, SimTuning } from '../../sim/types';
import { SelectField, TextField } from '../fields';
import { Section } from '../Section';

/**
 * Settings of a micro run in the panel on the right: the run itself (length, demand, people) and,
 * folded, every number the model is built from. An empty field keeps the default, shown greyed.
 */

const MINUTES = [['5', '5 мин'], ['10', '10 мин'], ['15', '15 мин'], ['20', '20 мин'], ['30', '30 мин']] as const;
const DEMANDS = [['random', 'Случайный спрос'], ['rush', 'Час пик'], ['custom', 'Свои потоки'], ['od', 'Из макромодели']] as const;
const MODELS = [['Krauss', 'Krauss, по умолчанию'], ['IDM', 'IDM, интеллектуальный водитель'], ['EIDM', 'EIDM, расширенный IDM'], ['W99', 'Wiedemann 99, как в Vissim']] as const;
/** Default shares of the vehicle types, percent, in the order of sim.rs VTYPES. */
const MIX = [['Легковые', 78], ['Фургоны', 8], ['Грузовые', 6], ['Автопоезда', 3], ['Автобусы', 4], ['Сочленённые', 1]] as const;

type NumKey = Exclude<keyof SimTuning, 'car_follow' | 'mix'>;

function Num({ label, k, def, hint }: { label: string; k: NumKey; def: number; hint?: string }) {
  const value = useSim((s) => s.tuning[k]);
  const set = useSim((s) => s.setTuning);
  return (
    <div className={`tune-field${value === undefined ? '' : ' is-set'}`} title={hint}>
      <TextField label={label} type="number" value={value === undefined ? '' : String(value)} placeholder={String(def)}
        onCommit={(v) => { const n = Number(v.replace(',', '.')); set({ [k]: v === '' || !Number.isFinite(n) ? undefined : n }); }} />
    </div>
  );
}

function Mix() {
  const mix = useSim((s) => s.tuning.mix);
  const set = useSim((s) => s.setTuning);
  const total = (mix ?? MIX.map(([, v]) => v)).reduce((a, b) => a + b, 0);
  return (
    <>
      <div className="tune-grid">
        {MIX.map(([label, def], i) => (
          <div key={label} className={`tune-field${mix && mix[i] !== def ? ' is-set' : ''}`}>
            <TextField label={`${label}, %`} type="number" value={mix ? String(mix[i]) : ''} placeholder={String(def)}
              onCommit={(v) => {
                const next = (mix ?? MIX.map(([, d]) => d)).slice();
                const n = Number(v.replace(',', '.'));
                next[i] = v === '' || !Number.isFinite(n) || n < 0 ? def : n;
                set({ mix: next.every((x, j) => x === MIX[j][1]) ? undefined : next });
              }} />
          </div>
        ))}
      </div>
      {mix && Math.abs(total - 100) > 0.5 && <p className="hint">Сумма {total}%: доли будут приведены к 100%.</p>}
    </>
  );
}

export function SimSettings() {
  const s = useSim();
  const changed = Object.keys(s.tuning).length;
  const rush = s.demand === 'rush';
  return (
    <>
      <Section title="Прогон">
        <fieldset className="tune-set" disabled={s.running}>
          <div className="row">
            <SelectField label="Длительность" value={String(s.minutes)} options={MINUTES} onChange={(v) => s.setMinutes(Number(v))} />
            <SelectField label="Спрос" value={s.demand} options={DEMANDS} onChange={(v) => s.setDemand(v as DemandKind)} />
          </div>
          <label className="check" title="Тротуары, переходы и пешие поездки: машины уступают людям на зебрах и светофорах">
            <input type="checkbox" checked={s.pedestrians} onChange={(e) => s.setPedestrians(e.target.checked)} /> Пешеходы
          </label>
        </fieldset>
      </Section>
      <Section title="Тонкая настройка модели" open={false} aside={changed ? <span className="mono count">{changed}</span> : undefined}>
        <fieldset className="tune-set" disabled={s.running}>
          <p className="micro tune-head">Спрос</p>
          <div className="tune-grid">
            <Num label="Машин в час" k="vehicles_per_hour" def={rush ? 10286 : 3000} hint="Сколько машин въезжает в сеть за час. Работает для случайного спроса и часа пик" />
            <Num label="Транзит через край" k="fringe_factor" def={rush ? 12 : 5} hint="Во сколько раз чаще поездки начинаются и кончаются у края фрагмента: 1 — равномерно, больше — сильнее транзит" />
            <Num label="Пешеходов в час" k="peds_per_hour" def={2400} hint="Пешие поездки в час, когда включены пешеходы" />
            <Num label="Seed" k="seed" def={42} hint="Случайное зерно поездок: тот же seed и те же настройки дают тот же прогон" />
          </div>
          <p className="micro tune-head">Водители</p>
          <SelectField label="Модель следования" value={s.tuning.car_follow ?? 'Krauss'} options={MODELS} onChange={(v) => s.setTuning({ car_follow: v === 'Krauss' ? undefined : (v as SimTuning['car_follow']) })} />
          <div className="tune-grid">
            <Num label="Несовершенство σ" k="sigma" def={0.5} hint="0 — идеальный водитель, 1 — очень неровная езда. От 0 до 1" />
            <Num label="Интервал τ, с" k="tau" def={1} hint="Желаемый интервал до впереди идущей машины, от 0,1 до 5 с" />
            <Num label="Скорость к лимиту" k="speed_factor" def={1} hint="1 — едут по ограничению, 1,1 — на 10% быстрее. От 0,5 до 1,5" />
            <Num label="Разброс скорости" k="speed_dev" def={0.1} hint="Насколько водители различаются по скорости, от 0 до 0,5" />
          </div>
          <p className="micro tune-head">Состав потока</p>
          <Mix />
          <p className="micro tune-head">Расчёт</p>
          <div className="tune-grid">
            <Num label="Шаг модели, с" k="step_length" def={1} hint="Меньше шаг — точнее и медленнее, от 0,1 до 1 с" />
            <Num label="Телепорт застрявших, с" k="time_to_teleport" def={300} hint="Машина, стоящая дольше, переносится дальше по маршруту. 0 — никогда" />
          </div>
          <p className="hint">Пустое поле — значение по умолчанию, оно показано серым. Изменённые поля отмечены слева. Настройки сохраняются между запусками.</p>
          {changed > 0 && <div className="buttons"><button type="button" className="btn" onClick={s.resetTuning}>Сбросить всё по умолчанию</button></div>}
        </fieldset>
      </Section>
    </>
  );
}
