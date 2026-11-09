import { useState } from 'react';
import { defaultName, useScenarios, type Scenario } from '../scenarios/store';

type Row = { label: string; unit: string; get: (s: Scenario) => number | undefined; digits: number; better: 'up' | 'down'; level: 'macro' | 'micro' };

const ROWS: Row[] = [
  { level: 'macro', label: 'Пробег', unit: 'авт-км/ч', get: (s) => s.macro?.vkt, digits: 0, better: 'down' },
  { level: 'macro', label: 'Время в пути', unit: 'авт-ч/ч', get: (s) => s.macro?.vht, digits: 0, better: 'down' },
  { level: 'macro', label: 'Перегружено дуг', unit: 'V/C > 1', get: (s) => s.macro?.overloaded, digits: 0, better: 'down' },
  { level: 'micro', label: 'Задержка', unit: 'с на поездку', get: (s) => s.micro?.delay, digits: 1, better: 'down' },
  { level: 'micro', label: 'Скорость', unit: 'км/ч', get: (s) => s.micro?.speed, digits: 1, better: 'up' },
  { level: 'micro', label: 'Ожидание', unit: 'с', get: (s) => s.micro?.waiting, digits: 1, better: 'down' },
  { level: 'micro', label: 'Доехало', unit: 'из плана', get: (s) => (s.micro && s.micro.trips ? (100 * s.micro.finished) / s.micro.trips : undefined), digits: 0, better: 'up' },
];

function Cell({ value, base, row, stale }: { value: number | undefined; base: number | undefined; row: Row; stale: boolean }) {
  if (value === undefined) return <td className="mono muted">—</td>;
  const d = base === undefined ? 0 : value - base;
  const shown = Math.abs(d) >= 10 ** -row.digits / 2;
  const good = row.better === 'up' ? d > 0 : d < 0;
  return (
    <td className={`mono${stale ? ' stale' : ''}`} title={stale ? 'Граф правили после расчёта: пересчитайте' : undefined}>
      {value.toFixed(row.digits)}{row.label === 'Доехало' ? '%' : ''}
      {shown && <span className={`kpi-delta ${good ? 'good' : 'bad'}`}> {d > 0 ? '+' : '−'}{Math.abs(d).toFixed(row.digits)}</span>}
    </td>
  );
}

/** Graph variants inside the session: save, switch, compare macro and micro KPIs side by side. */
export function ScenariosPanel() {
  const { list, active, save, switchTo, remove, rename } = useScenarios();
  const [name, setName] = useState('');
  const base = list[0];
  return (
    <div className="scenarios">
      <div className="scenarios-controls">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={defaultName(list.length)} aria-label="Имя сценария" />
        <button className="btn btn-ink" onClick={() => { save(name); setName(''); }}>Сохранить как сценарий</button>
        <p className="hint">Сценарий запоминает граф и последние результаты «Потоков» и «Микро». Переключение подставляет его граф в редактор; правки активного сценария сохраняются в нём. Первый сценарий служит базой для разницы.</p>
      </div>
      {list.length > 0 && (
        <div className="scenarios-table-wrap">
          <table className="scenarios-table">
            <thead>
              <tr>
                <th />
                {list.map((s) => (
                  <th key={s.id} className={s.id === active ? 'on' : ''}>
                    <input className="scenario-name" defaultValue={s.name} key={s.name} aria-label="Имя сценария" onBlur={(e) => rename(s.id, e.target.value)} />
                    <div className="scenario-actions">
                      {s.id === active ? <span className="micro">открыт</span> : <button className="link" onClick={() => switchTo(s.id)}>Открыть</button>}
                      <button className="link" onClick={() => remove(s.id)} aria-label={`Удалить ${s.name}`}>Удалить</button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r, i) => (
                <tr key={r.label} className={i === 3 ? 'level-start' : ''}>
                  <th scope="row"><span className="micro">{r.level === 'macro' ? 'Макро' : 'Микро'}</span> {r.label} <span className="muted">{r.unit}</span></th>
                  {list.map((s) => (
                    <Cell key={s.id} row={r} value={r.get(s)} base={s === base ? undefined : r.get(base)}
                      stale={(r.level === 'macro' ? s.macroDoc : s.microDoc) !== s.doc} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
