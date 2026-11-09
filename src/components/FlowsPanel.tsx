import { useState } from 'react';
import { saveTextFile } from '../platform';
import { TripTimeChart } from './TripTimeChart';
import { BundleSection } from './BundleSection';
import { ISO_BANDS, useMacro, VC_BANDS } from '../macro/store';
import { useEditor } from '../state/store';

/** Macro level: grid zones, gravity OD matrix, equilibrium assignment and isochrones. */
export function FlowsPanel() {
  const { side, trips, busy, error, result, isoFrom, setSide, setTrips, run, isochrone, clear, points, placing, setPlacing, setPoints, odEdited, setCell, resetOd, beta, setBeta, calibrate } = useMacro();
  const [target, setTarget] = useState('');
  const [fitted, setFitted] = useState(0);
  const selection = useEditor((s) => s.selection);
  const node = selection?.type === 'node' ? selection.id : null;

  const exportOd = () => {
    if (!result) return;
    const names = result.zones.map((z) => z.name);
    const rows = [['from/to', ...names].join(','), ...result.od.map((row, i) => [names[i], ...row].join(','))];
    void saveTextFile(rows.join('\n'), 'hack-team10-od.csv', 'CSV', 'csv');
  };

  return (
    <div className="flows">
      <div className="flows-controls">
        <label className="field"><span className="micro">Зоны</span>
          <select value={points ? 'manual' : side} onChange={(e) => (e.target.value === 'manual' ? setPlacing(true) : setSide(Number(e.target.value)))}>
            {[2, 3, 4, 5].map((n) => <option key={n} value={n}>сетка {n}×{n}</option>)}
            <option value="manual">вручную{points ? `, ${points.length}` : ''}</option>
          </select>
        </label>
        <button className={`btn${placing ? ' btn-ink' : ''}`} aria-pressed={placing} onClick={() => setPlacing(!placing)}
          title="Клик по карте ставит центр зоны, перетаскивание двигает, правый клик или Alt+клик удаляет">{placing ? 'Готово' : 'Ставить зоны'}</button>
        {points && !placing && <button className="btn btn-quiet" onClick={() => { setPoints(null); void run(); }}>Вернуть сетку</button>}
        <label className="field"><span className="micro">Поездок в час пик</span>
          <input type="number" min={100} step={500} value={trips} onChange={(e) => setTrips(Math.max(0, Number(e.target.value) || 0))} />
        </label>
        <label className="field field-beta"><span className="micro"><span className="greek">β</span> гравитации: {beta.toFixed(3)}</span>
          <input type="range" min={0.02} max={0.4} step={0.005} value={beta} onChange={(e) => setBeta(Number(e.target.value))} onPointerUp={() => void run()} onKeyUp={(e) => { if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End' || e.key.startsWith('Page')) void run(); }}
            title="Чем больше β, тем короче поездки: люди реже ездят далеко" />
        </label>
        <button className="btn btn-primary" onClick={() => void run()} disabled={busy}>{busy ? 'Считаю…' : 'Распределить потоки'}</button>
        <button className="btn" disabled={!node || busy} onClick={() => node && isochrone(node)} title={node ? '' : 'Выберите узел на карте'}>Изохроны от узла</button>
        {(result || isoFrom) && <button className="btn" onClick={clear}>Очистить</button>}
      </div>
      {result && (
        <div className="calibrate">
          <label className="field"><span className="micro">Средняя поездка, мин</span>
            <input type="number" min={1} max={60} step={0.5} value={target} placeholder={result.meanTime.toFixed(1)} onChange={(e) => setTarget(e.target.value)} />
          </label>
          <button className="btn" disabled={busy || !(Number(target) > 0)} onClick={() => { setFitted(Number(target)); void calibrate(Number(target)); }}>Подобрать β</button>
          {result.calibrated === 'ok' && <span className="hint">β подобран под {fitted.toFixed(1)} мин с учётом загрузки сети.</span>}
          {result.calibrated === 'unreachable' && <span className="hint err">На этом фрагменте средняя поездка бывает только {result.reachable ? `от ${result.reachable[0].toFixed(1)} до ${result.reachable[1].toFixed(1)} мин` : 'в узких пределах'}: выберите значение в этом диапазоне.</span>}
        </div>
      )}
      {error && <p className="hint err">{error}</p>}
      {placing && <p className="hint">Кликните по карте, чтобы поставить центр зоны. Тащите, чтобы сдвинуть. Правый клик удаляет. Нужно минимум две зоны.</p>}
      {!result && !isoFrom && (
        <p className="hint">Граф делится на зоны сеткой или по центрам, которые вы ставите сами. Вес зоны считается по площади зданий с учётом этажности, матрица корреспонденций считается гравитационной моделью, цели «дом–работа» и «дом–прочее» считаются отдельно: работа тянется к нежилым зданиям и меньше зависит от времени. Потоки распределяются по равновесию Вардропа (Франк-Вульф, BPR). Толщина линии показывает поток, цвет показывает загрузку V/C.</p>
      )}
      {result && (
        <div className="flows-result">
          <div className="kpis">
            <div><span className="kpi">{Math.round(result.vkt)}</span><span className="micro">авт·км/ч</span></div>
            <div><span className="kpi">{Math.round(result.vht)}</span><span className="micro">авт·ч/ч</span></div>
            <div><span className="kpi">{result.overloaded}</span><span className="micro">Перегружено дуг</span></div>
            <div><span className="kpi">{result.iterations}</span><span className="micro">Итераций</span></div>
            <div><span className="kpi">{(result.gap * 100).toFixed(2)}%</span><span className="micro">Зазор</span></div>
            <div><span className="kpi">{result.unrouted}</span><span className="micro">Без маршрута</span></div>
          </div>
          <div className="od-wrap">
            <table className="od">
              <thead><tr><th />{result.zones.map((z) => <th key={z.id}>{z.name}</th>)}</tr></thead>
              <tbody>{result.od.map((row, i) => (
                <tr key={i}><th>{result.zones[i].name}</th>{row.map((v, j) => (
                  <td key={j} className="mono">{i === j ? '' : (
                    <input className="od-cell" type="number" min={0} defaultValue={v} key={v} aria-label={`${result.zones[i].name} → ${result.zones[j].name}`}
                      onBlur={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n !== v) setCell(i, j, n); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />)}</td>))}</tr>
              ))}</tbody>
            </table>
            <p className="hint">Ячейки можно править: поездок в час из зоны строки в зону столбца. Потоки пересчитаются сразу, а Микро со спросом «Из макромодели» возьмёт эту матрицу.</p>
            <div className="buttons">
              <button className="btn" onClick={exportOd}>Матрица в CSV</button>
              {odEdited && <button className="btn btn-quiet" onClick={resetOd}>Сбросить правки матрицы</button>}
            </div>
          </div>
          <div className="trip-side">
            <TripTimeChart bins={result.histogram} mean={result.meanTime} />
            {result.purposes.length > 0 && (
              <table className="purposes">
                <thead><tr><th>Цель</th><th>Поездок/ч</th><th>Среднее, мин</th></tr></thead>
                <tbody>{result.purposes.map((p) => <tr key={p.id}><th>{p.label}</th><td className="mono">{p.trips}</td><td className="mono">{p.meanTime.toFixed(1)}</td></tr>)}</tbody>
              </table>
            )}
            {!result.purposes.length && <p className="hint">Матрица правилась вручную, поэтому разбивки по целям нет.</p>}
          </div>
          <ul className="legend">{VC_BANDS.map((b) => <li key={b.label}><i className="swatch-dot" style={{ background: b.color }} />V/C {b.label}</li>)}</ul>
          <BundleSection />
        </div>
      )}
      {isoFrom && <ul className="legend">{ISO_BANDS.map((b) => <li key={b.label}><i className="swatch-dot" style={{ background: b.color }} />{b.label}</li>)}</ul>}
    </div>
  );
}
