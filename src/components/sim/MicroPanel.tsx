import { ROAD_CLASSES } from '../../map/palette';
import { useMemo } from 'react';
import { useUi } from '../../state/ui';
import { saveTextFile } from '../../platform';
import { levelOfService, series, simEnd, SPEED_BANDS, useSim } from '../../sim/store';
import { LOS_COLORS, SIGNAL_COLORS, statsByWay } from '../../sim/overlay';
import type { SimResult } from '../../sim/types';
import { currentSelection, useEditor } from '../../state/store';

const TYPE_LABELS: Readonly<Record<string, string>> = {
  car: 'Легковой, 4,5 м', van: 'Фургон до 3,5 т, 5,5 м', truck: 'Грузовой, 9 м', trailer: 'Автопоезд, 16,5 м', bus: 'Автобус, 12 м', bus18: 'Автобус, 18 м', ptbus: 'Автобус маршрута ОТ', ped: 'Пешеход',
};

const LOS_TONE: Readonly<Record<string, string>> = { A: 'var(--green)', B: 'var(--green)', C: 'var(--yellow)', D: 'var(--orange)', E: 'var(--red)', F: 'var(--red)' };

/** Line chart of one series with a cursor at the current model time. */
function Chart({ points, value, label, unit, time, end }: { points: Array<{ t: number; y: number }>; value: number; label: string; unit: string; time: number; end: number }) {
  const W = 280; const H = 64;
  const max = Math.max(1, ...points.map((p) => p.y));
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${((p.t / (end || 1)) * W).toFixed(1)},${(H - (p.y / max) * (H - 4)).toFixed(1)}`).join('');
  const x = (time / (end || 1)) * W;
  return (
    <figure className="chart">
      <figcaption><span className="micro">{label}</span><span className="mono">{Math.round(value)} {unit}</span></figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
        <path d={d} fill="none" stroke="var(--ink)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <line x1={x} x2={x} y1={0} y2={H} stroke="var(--pink)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
    </figure>
  );
}

/** Street name, or road class plus id for unnamed ways. */
function wayLabel(way: { tags: Record<string, string> } | undefined, id: string): string {
  if (way?.tags.name) return way.tags.name;
  const cls = ROAD_CLASSES.find((c) => (c.match as readonly string[]).includes(way?.tags.highway ?? ''));
  return `${cls ? cls.label.split(',')[0] : 'Дорога'} · ${id}`;
}

const DEMAND_LABEL = { random: 'случайные поездки', od: 'матрица из макромодели' } as const;

/** One KPI with its change against the baseline; `better` says which sign is good. */
function Kpi({ value, base, label, digits = 1, better }: { value: number; base?: number; label: string; digits?: number; better: 'up' | 'down' }) {
  const delta = base === undefined ? null : value - base;
  const good = delta !== null && (better === 'up' ? delta > 0 : delta < 0);
  const shown = delta !== null && Math.abs(delta) >= 10 ** -digits / 2;
  return (
    <div>
      <span className="kpi">{value.toFixed(digits)}</span>
      <span className="micro">{label}</span>
      {shown && <span className={`kpi-delta ${good ? 'good' : 'bad'}`}>{delta > 0 ? '+' : '−'}{Math.abs(delta).toFixed(digits)}</span>}
    </div>
  );
}

/** Ways whose delay changed most against the baseline. */
function wayChanges(result: SimResult, baseline: SimResult) {
  const before = statsByWay(baseline);
  return result.ways
    .map((w) => ({ w, d: w.delay_s - (before.get(w.way)?.delay_s ?? w.delay_s) }))
    .filter((x) => Math.abs(x.d) >= 1)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
}

function SelectedWay({ result, baseline }: { result: SimResult; baseline: SimResult | null }) {
  const doc = useEditor((s) => s.doc);
  const sel = useEditor((s) => currentSelection(s));
  if (sel?.type !== 'way') return <p className="hint">Кликните дорогу на карте, чтобы увидеть её задержку, скорость и уровень обслуживания.</p>;
  const st = statsByWay(result).get(sel.id);
  const name = wayLabel(doc.ways[sel.id], sel.id);
  if (!st) return <p className="hint">{name}: за прогон по этой дороге никто не проехал.</p>;
  const base = baseline ? statsByWay(baseline).get(sel.id) : undefined;
  const los = levelOfService(st.delay_s);
  return (
    <div className="way-los">
      <div className="way-los-head"><i className="swatch-dot" style={{ background: LOS_COLORS[los] }} /><strong>{name}</strong><span className="mono">LOS {los}</span></div>
      <div className="kpis">
        <Kpi value={st.entered} base={base?.entered} label="Проехало ТС" digits={0} better="up" />
        <Kpi value={st.speed_kmh} base={base?.speed_kmh} label="Скорость, км/ч" better="up" />
        <Kpi value={st.delay_s} base={base?.delay_s} label="Задержка, с" better="down" />
        <Kpi value={st.waiting_s} base={base?.waiting_s} label="Стоянка, с" better="down" />
      </div>
    </div>
  );
}

/** Walking people: delay at crossings and the busiest crossings, which also slow cars down. */
function Pedestrians({ result, baseline }: { result: SimResult; baseline: SimResult | null }) {
  const flyTo = useUi((s) => s.flyTo);
  const d = 0.0006;
  return (
    <section className="micro-section">
      <div className="micro">Пешеходы</div>
      <div className="kpis kpis-2">
        <Kpi value={result.persons ?? 0} base={baseline?.persons} label="Людей вышло" digits={0} better="up" />
        <Kpi value={result.ped_mean_time_loss_s ?? 0} base={baseline?.ped_mean_time_loss_s} label="Задержка на проход, с" better="down" />
      </div>
      {!!result.crossings?.length && (
        <ul className="changes">
          {result.crossings.slice(0, 5).map((c, i) => (
            <li key={`${c.lon},${c.lat}`}>
              <button className="link" onClick={() => flyTo([c.lon - d, c.lat - d, c.lon + d, c.lat + d])}>Переход {i + 1}</button>
              <span className="mono">{c.peds} чел.</span>
            </li>
          ))}
        </ul>
      )}
      <p className="hint">Задержка пешехода включает ожидание зелёного и разрыва в потоке. Влияние переходов на машины видно в сравнении: запомните прогон без пешеходов как базовый и пересчитайте с ними.</p>
    </section>
  );
}

export function MicroPanel() {
  const { result, time, running, error, baseline, keepBaseline, dropBaseline } = useSim();
  const select = useEditor((s) => s.select);
  const ways = useEditor((s) => s.doc.ways);
  const b = baseline && baseline !== result ? baseline : null;
  const changes = useMemo(() => (result && b ? wayChanges(result, b) : []), [result, b]);
  const data = useMemo(() => (result ? series(result) : []), [result]);
  const end = simEnd(result);
  const now = data.find((p) => p.t >= time) ?? data[data.length - 1];

  const exportCsv = () => {
    if (!result) return;
    const rows = ['time_s,vehicles,mean_speed_kmh', ...data.map((p) => `${p.t},${p.n},${p.kmh.toFixed(1)}`)];
    void saveTextFile(rows.join('\n'), 'hack-team10-sim.csv', 'CSV', 'csv');
  };

  return (
    <aside className="panel inspector-panel micro-panel" aria-label="Микросимуляция">
      <div className="panel-title micro">Микросимуляция · SUMO</div>
      {!result && (
        <div className="insp-empty">
          <div className="insp-empty-mark" aria-hidden="true" />
          <p>{running ? 'Считаю модель…' : 'Модели ещё нет'}</p>
          <p className="hint">{error ?? 'Кнопка «Запустить SUMO» строит сеть из текущего графа через netconvert, пускает смешанный поток и проигрывает движение машин. Спрос «Из макромодели» берёт матрицу корреспонденций из «Потоков», так что оба уровня считают одни и те же поездки.'}</p>
        </div>
      )}
      {result && (
        <>
          <section className="los-card" style={{ ['--los' as string]: LOS_TONE[levelOfService(result.mean_time_loss_s)] }}>
            <span className="los-letter">{levelOfService(result.mean_time_loss_s)}</span>
            <div>
              <span className="micro">Уровень обслуживания</span>
              <p className="hint">По HCM, средняя задержка {result.mean_time_loss_s.toFixed(1)} с на поездку. Спрос: {DEMAND_LABEL[result.demand]}, {result.trips} поездок.</p>
            </div>
          </section>
          {!!result.transit_lines && (
            <p className="hint micro-pt">Общественный транспорт: {result.transit_lines} маршр., доехало автобусов {result.pt_finished ?? 0}{result.pt_finished ? `, средняя скорость ${(result.pt_mean_speed_kmh ?? 0).toFixed(1)} км/ч` : ''}.</p>
          )}
          {!!result.persons && <Pedestrians result={result} baseline={b} />}
          {result.trips > 0 && result.finished < result.trips / 2 && (
            <p className="cordon-hint">Доехали {result.finished} из {result.trips} поездок: остальные стоят в очереди на въезд или ещё в пути, когда модель кончилась. Увеличьте длительность до 20 мин или проверьте разрывы сети во вкладке «Валидация».</p>
          )}
          <div className="kpis">
            <Kpi value={result.vehicles} base={b?.vehicles} label="ТС выпущено" digits={0} better="up" />
            <Kpi value={result.mean_speed_kmh} base={b?.mean_speed_kmh} label="Скорость, км/ч" better="up" />
            <Kpi value={result.mean_waiting_s} base={b?.mean_waiting_s} label="Ожидание, с" better="down" />
            <Kpi value={result.mean_time_loss_s} base={b?.mean_time_loss_s} label="Задержка, с" better="down" />
            <Kpi value={result.mean_duration_s / 60} base={b ? b.mean_duration_s / 60 : undefined} label="В пути, мин" better="down" />
            <Kpi value={result.teleports} base={b?.teleports} label="Телепортаций" digits={0} better="down" />
          </div>
          <div className="section-body compare">
            <span className="micro">Сравнение до и после</span>
            {!baseline && <p className="hint">Запомните этот прогон, поправьте граф и пересчитайте: здесь появится разница по сети и по каждой дороге.</p>}
            {b && (changes.length
              ? <ul className="changes">{changes.slice(0, 6).map(({ w, d }) => (
                <li key={w.way}><button className="link" onClick={() => select({ type: 'way', id: w.way })}>{wayLabel(ways[w.way], w.way)}</button>
                  <span className={`mono ${d < 0 ? 'good' : 'bad'}`}>{d > 0 ? '+' : '−'}{Math.abs(d).toFixed(0)} с</span></li>))}</ul>
              : <p className="hint">Задержки на дорогах почти не изменились.</p>)}
            {baseline === result && <p className="hint">Это базовый прогон. Внесите правку и нажмите «Пересчитать».</p>}
            <div className="buttons">
              <button className="btn" onClick={keepBaseline} disabled={baseline === result}>{baseline ? 'Сделать базовым' : 'Запомнить как базовый'}</button>
              {baseline && <button className="btn" onClick={dropBaseline}>Сбросить</button>}
            </div>
          </div>
          <div className="section-body">
            <span className="micro">Выбранная дорога</span>
            <SelectedWay result={result} baseline={b} />
          </div>
          <div className="section-body charts">
            <Chart points={data.map((p) => ({ t: p.t, y: p.n }))} value={now?.n ?? 0} label="ТС в сети" unit="" time={time} end={end} />
            <Chart points={data.map((p) => ({ t: p.t, y: p.kmh }))} value={now?.kmh ?? 0} label="Средняя скорость" unit="км/ч" time={time} end={end} />
          </div>
          <div className="section-body">
            <span className="micro">Скорость машин</span>
            <ul className="legend">{SPEED_BANDS.map((b) => <li key={b.label}><i className="swatch-dot" style={{ background: b.color }} />{b.label}</li>)}</ul>
            <span className="micro">Дороги по уровню обслуживания</span>
            <ul className="legend">{(['A', 'C', 'D', 'E'] as const).map((l, i) => <li key={l}><i className="swatch-dot" style={{ background: LOS_COLORS[l] }} />{['A–B, свободно', 'C, устойчиво', 'D, плотно', 'E–F, затор'][i]}</li>)}</ul>
            {result.signals.length > 0 && <>
              <span className="micro">Сигналы светофоров</span>
              <ul className="legend">{(['green', 'yellow', 'red'] as const).map((c, i) => <li key={c}><i className="swatch-dot" style={{ background: SIGNAL_COLORS[c] }} />{['зелёный', 'жёлтый', 'красный'][i]}</li>)}</ul>
            </>}
            <span className="micro">Типы ТС в потоке</span>
            <ul className="legend">{result.types.map((t) => <li key={t}>{TYPE_LABELS[t] ?? t}</li>)}</ul>
            <button className="btn" onClick={exportCsv}>Экспорт CSV</button>
          </div>
        </>
      )}
    </aside>
  );
}
