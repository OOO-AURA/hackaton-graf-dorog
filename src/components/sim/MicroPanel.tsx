import { useMemo } from 'react';
import { downloadText } from '../../platform';
import { levelOfService, series, simEnd, SPEED_BANDS, useSim } from '../../sim/store';

const TYPE_LABELS: Readonly<Record<string, string>> = {
  car: 'Легковой, 4,5 м', van: 'Фургон до 3,5 т, 5,5 м', truck: 'Грузовой, 9 м', trailer: 'Автопоезд, 16,5 м', bus: 'Автобус, 12 м', bus18: 'Автобус, 18 м',
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

export function MicroPanel() {
  const { result, time, running, error } = useSim();
  const data = useMemo(() => (result ? series(result) : []), [result]);
  const end = simEnd(result);
  const now = data.find((p) => p.t >= time) ?? data[data.length - 1];

  const exportCsv = () => {
    if (!result) return;
    const rows = ['time_s,vehicles,mean_speed_kmh', ...data.map((p) => `${p.t},${p.n},${p.kmh.toFixed(1)}`)];
    downloadText(rows.join('\n'), 'hack-team10-sim.csv');
  };

  return (
    <aside className="panel inspector-panel micro-panel" aria-label="Микросимуляция">
      <div className="panel-title micro">Микросимуляция · SUMO</div>
      {!result && (
        <div className="insp-empty">
          <div className="insp-empty-mark" aria-hidden="true" />
          <p>{running ? 'Считаю модель…' : 'Модели ещё нет'}</p>
          <p className="hint">{error ?? 'Кнопка «Запустить SUMO» на карте строит сеть из текущего графа через netconvert, пускает случайные поездки смешанного потока и проигрывает движение машин.'}</p>
        </div>
      )}
      {result && (
        <>
          <section className="los-card" style={{ ['--los' as string]: LOS_TONE[levelOfService(result.mean_time_loss_s)] }}>
            <span className="los-letter">{levelOfService(result.mean_time_loss_s)}</span>
            <div>
              <span className="micro">Уровень обслуживания</span>
              <p className="hint">По HCM, средняя задержка {result.mean_time_loss_s.toFixed(1)} с на поездку</p>
            </div>
          </section>
          <div className="kpis">
            <div><span className="kpi">{result.vehicles}</span><span className="micro">ТС выпущено</span></div>
            <div><span className="kpi">{result.mean_speed_kmh.toFixed(1)}</span><span className="micro">Скорость, км/ч</span></div>
            <div><span className="kpi">{result.mean_waiting_s.toFixed(1)}</span><span className="micro">Ожидание, с</span></div>
            <div><span className="kpi">{(result.mean_duration_s / 60).toFixed(1)}</span><span className="micro">В пути, мин</span></div>
            <div><span className="kpi">{result.traffic_lights}</span><span className="micro">Светофоров</span></div>
            <div><span className="kpi">{result.teleports}</span><span className="micro">Телепортаций</span></div>
          </div>
          <div className="section-body charts">
            <Chart points={data.map((p) => ({ t: p.t, y: p.n }))} value={now?.n ?? 0} label="ТС в сети" unit="" time={time} end={end} />
            <Chart points={data.map((p) => ({ t: p.t, y: p.kmh }))} value={now?.kmh ?? 0} label="Средняя скорость" unit="км/ч" time={time} end={end} />
          </div>
          <div className="section-body">
            <span className="micro">Скорость машин</span>
            <ul className="legend">{SPEED_BANDS.map((b) => <li key={b.label}><i className="swatch-dot" style={{ background: b.color }} />{b.label}</li>)}</ul>
            <span className="micro">Типы ТС в потоке</span>
            <ul className="legend">{result.types.map((t) => <li key={t}>{TYPE_LABELS[t] ?? t}</li>)}</ul>
            <button className="btn" onClick={exportCsv}>Экспорт CSV</button>
          </div>
        </>
      )}
    </aside>
  );
}
