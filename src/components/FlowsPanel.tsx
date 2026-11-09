import { downloadText } from '../platform';
import { ISO_BANDS, useMacro, VC_BANDS } from '../macro/store';
import { useEditor } from '../state/store';

/** Macro level: grid zones, gravity OD matrix, equilibrium assignment and isochrones. */
export function FlowsPanel() {
  const { side, trips, result, isoFrom, setSide, setTrips, run, isochrone, clear } = useMacro();
  const selection = useEditor((s) => s.selection);
  const node = selection?.type === 'node' ? selection.id : null;

  const exportOd = () => {
    if (!result) return;
    const names = result.zones.map((z) => z.name);
    const rows = [['from/to', ...names].join(','), ...result.od.map((row, i) => [names[i], ...row].join(','))];
    downloadText(rows.join('\n'), 'hack-team10-od.csv');
  };

  return (
    <div className="flows">
      <div className="flows-controls">
        <label className="field"><span className="micro">Зоны</span>
          <select value={side} onChange={(e) => setSide(Number(e.target.value))}>
            {[2, 3, 4, 5].map((n) => <option key={n} value={n}>сетка {n}×{n}</option>)}
          </select>
        </label>
        <label className="field"><span className="micro">Поездок в час пик</span>
          <input type="number" min={100} step={500} value={trips} onChange={(e) => setTrips(Math.max(0, Number(e.target.value) || 0))} />
        </label>
        <button className="btn btn-primary" onClick={run}>Распределить потоки</button>
        <button className="btn" disabled={!node} onClick={() => node && isochrone(node)} title={node ? '' : 'Выберите узел на карте'}>Изохроны от узла</button>
        {(result || isoFrom) && <button className="btn" onClick={clear}>Очистить</button>}
      </div>
      {!result && !isoFrom && (
        <p className="hint">Граф делится на зоны сеткой, матрица корреспонденций считается гравитационной моделью, потоки распределяются по равновесию Вардропа (Франк-Вульф, BPR). Толщина линии показывает поток, цвет показывает загрузку V/C.</p>
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
                <tr key={i}><th>{result.zones[i].name}</th>{row.map((v, j) => <td key={j} className="mono">{v || ''}</td>)}</tr>
              ))}</tbody>
            </table>
            <button className="btn" onClick={exportOd}>Матрица в CSV</button>
          </div>
          <ul className="legend">{VC_BANDS.map((b) => <li key={b.label}><i className="swatch-dot" style={{ background: b.color }} />V/C {b.label}</li>)}</ul>
        </div>
      )}
      {isoFrom && <ul className="legend">{ISO_BANDS.map((b) => <li key={b.label}><i className="swatch-dot" style={{ background: b.color }} />{b.label}</li>)}</ul>}
    </div>
  );
}
