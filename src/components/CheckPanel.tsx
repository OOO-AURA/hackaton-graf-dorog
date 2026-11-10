import { create } from 'zustand';
import type { CheckReport, StageStatus } from '../check';
import { serializeOsm } from '../osm/serialize';
import { isDesktop, runServerCheck } from '../platform';
import { useEditor } from '../state/store';
import { compareStage } from '../checkCompare';

interface CheckState {
  running: boolean;
  report: CheckReport | null;
  /** The same check on the file as it was opened, for the before/after columns. */
  baseline: CheckReport | null;
  error: string | null;
}

export const useCheck = create<CheckState>(() => ({
  running: false, report: null, baseline: null, error: null,
}));

/** Checks the opened file too, so every metric shows what the edits changed. */
async function runBaseline(): Promise<void> {
  const { baseDoc } = useEditor.getState();
  useCheck.setState({ running: true, error: null });
  try {
    const baseline = await runServerCheck(serializeOsm(baseDoc));
    useCheck.setState({ baseline });
  } catch (err) {
    useCheck.setState({ error: String(err) });
  } finally {
    useCheck.setState({ running: false });
  }
}

// A different file makes the old baseline meaningless.
useEditor.subscribe((s, prev) => { if (s.baseDoc !== prev.baseDoc) useCheck.setState({ baseline: null, report: null }); });

async function runCheck(): Promise<void> {
  const { doc } = useEditor.getState();
  useCheck.setState({ running: true, error: null });
  try {
    const report = await runServerCheck(serializeOsm(doc));
    useCheck.setState({ report });
  } catch (err) {
    useCheck.setState({ error: String(err) });
  } finally {
    useCheck.setState({ running: false });
  }
}

const STATUS_LABEL: Readonly<Record<StageStatus, string>> = { ok: 'OK', warn: 'Есть замечания', fail: 'Ошибка', skipped: 'Не запускалось' };

/** Runs the current graph through local SUMO, MATSim and Webots, like the check server does. */
export function CheckButton() {
  const running = useCheck((s) => s.running);
  const empty = useEditor((s) => !Object.keys(s.doc.nodes).length);
  if (!isDesktop) return null;
  return (
    <button className="btn" onClick={() => void runCheck()} disabled={running || empty} title="Прогнать граф через SUMO, MATSim и Webots локально">
      {running ? 'Проверяю…' : 'Проверить как на сервере'}
    </button>
  );
}

function Delta({ value }: { value: number | null }) {
  if (value === null || value === 0) return null;
  return <span className={`delta ${value > 0 ? 'up' : 'down'}`}>{value > 0 ? '+' : ''}{value}</span>;
}

export function CheckPanel() {
  const { running, report, baseline, error } = useCheck();
  return (
    <section className="check-panel" aria-live="polite">
      {!isDesktop && <p className="hint">Проверка на SUMO, MATSim и Webots работает в настольном приложении: в браузере нет доступа к этим программам.</p>}
      {isDesktop && !report && !running && !error && <p className="hint">Кнопка «Проверить как на сервере» на вкладке «Чек-лист сдачи» прогонит граф через те же адаптеры, что и сервер организаторов.</p>}
      {running && <p className="hint running">netconvert и sumo, MATSim OsmNetworkReader, импортёр Webots. Обычно 10–20 секунд.</p>}
      {error && <p className="check-error">{error}</p>}
      {report && !running && (
        <div className="check-stages">
          {report.stages.map((st) => (
            <article key={st.name} className={`check-stage ${st.status}`}>
              <h4>{st.name} <span>{STATUS_LABEL[st.status]} · {st.seconds} с</span></h4>
              <table>
                {baseline && <thead><tr><th /><th>было</th><th>стало</th></tr></thead>}
                <tbody>{compareStage(report, baseline, st.name).map((r) => (
                  <tr key={r.key}><td>{r.key}</td>{baseline && <td className="was">{r.before ?? '—'}</td>}<td>{r.after} <Delta value={r.delta} /></td></tr>
                ))}</tbody>
              </table>
              {st.problems.length > 0 && (
                <details open={st.status === 'fail'}>
                  <summary>Замечания: {st.problems.length}</summary>
                  <ul>{st.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
                </details>
              )}
              {st.log_tail && st.status === 'fail' && <pre>{st.log_tail}</pre>}
            </article>
          ))}
          <div className="buttons">
            <button className="btn btn-sm" onClick={() => void runBaseline()} disabled={running}>{baseline ? 'Пересчитать исходный файл' : 'Сравнить с исходным файлом'}</button>
          </div>
          <p className="hint">Сравнение прогоняет файл в том виде, в каком его открыли, и показывает рядом «было» и «стало». Это готовая таблица для защиты: что правки дали на каждом уровне. Файлы прогона: {report.work_dir}</p>
        </div>
      )}
    </section>
  );
}
