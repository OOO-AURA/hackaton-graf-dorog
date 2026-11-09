import { heatCell } from '../../sim/overlay';
import type { SimResult } from '../../sim/types';

/** Time × road heat map: each cell is the mean delay of vehicles entering the way in that minute. */
export function DelayHeatmap({ result, time, label, onPick, rows = 12 }: {
  result: SimResult; time: number; label: (way: string) => string; onPick: (way: string) => void; rows?: number;
}) {
  const tl = result.timeline;
  if (!tl?.ways.length) return null;
  const ways = tl.ways.slice(0, rows);
  const cols = Math.max(...ways.map((w) => w.delay.length));
  const now = Math.floor(time / tl.step_s);
  return (
    <section className="micro-section heat">
      <div className="micro">Задержки по времени</div>
      <div className="heat-grid" style={{ gridTemplateColumns: `minmax(0, 1fr) repeat(${cols}, 1fr)` }} role="table" aria-label="Задержка по дорогам и минутам модели">
        {ways.map((w) => (
          <div className="heat-row" role="row" key={w.way} style={{ display: 'contents' }}>
            <button className="link heat-label" role="rowheader" onClick={() => onPick(w.way)} title={label(w.way)}>{label(w.way)}</button>
            {Array.from({ length: cols }, (_, i) => {
              const d = w.delay[i] ?? 0;
              const c = heatCell(d);
              return <i key={i} role="cell" className={`heat-cell${i === now ? ' now' : ''}`} title={`${i}–${i + 1} мин: ${d.toFixed(1)} с`}
                style={{ background: c?.color ?? 'var(--field)', opacity: c?.opacity ?? 1 }} />;
            })}
          </div>
        ))}
        <span />
        {Array.from({ length: cols }, (_, i) => <span key={i} className="heat-tick mono">{i % 5 === 0 ? i : ''}</span>)}
      </div>
      <p className="hint">Строки: дороги с наибольшей потерей времени, столбцы: минуты модели. Цвет по уровню обслуживания, насыщенность растёт с задержкой. Рамка отмечает текущую минуту проигрывания.</p>
    </section>
  );
}
