import { create } from 'zustand';
import type { CheckReport, StageStatus } from '../check';
import { serializeOsm } from '../osm/serialize';
import { isDesktop, runServerCheck } from '../platform';
import { useEditor } from '../state/store';

interface CheckState {
  running: boolean;
  open: boolean;
  report: CheckReport | null;
  error: string | null;
  setOpen: (open: boolean) => void;
}

const useCheck = create<CheckState>((set) => ({
  running: false, open: false, report: null, error: null,
  setOpen: (open) => set({ open }),
}));

async function runCheck(): Promise<void> {
  const { doc } = useEditor.getState();
  useCheck.setState({ running: true, open: true, error: null });
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
    <button onClick={() => void runCheck()} disabled={running || empty} title="Прогнать граф через SUMO, MATSim и Webots локально">
      {running ? 'Проверяю…' : 'Проверить как на сервере'}
    </button>
  );
}

export function CheckPanel() {
  const { open, running, report, error, setOpen } = useCheck();
  if (!open) return null;
  return (
    <section className="check-panel" aria-live="polite">
      <header>
        <h3>Проверка как на сервере</h3>
        <button className="icon" onClick={() => setOpen(false)} aria-label="Закрыть">×</button>
      </header>
      {running && <p className="hint">netconvert и sumo, MATSim OsmNetworkReader, импортёр Webots. Обычно 10–20 секунд.</p>}
      {error && <p className="check-error">{error}</p>}
      {report && !running && (
        <div className="check-stages">
          {report.stages.map((st) => (
            <article key={st.name} className={`check-stage ${st.status}`}>
              <h4>{st.name} <span>{STATUS_LABEL[st.status]} · {st.seconds} с</span></h4>
              <table><tbody>{st.metrics.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</tbody></table>
              {st.problems.length > 0 && (
                <details open={st.status === 'fail'}>
                  <summary>Замечания: {st.problems.length}</summary>
                  <ul>{st.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
                </details>
              )}
              {st.log_tail && st.status === 'fail' && <pre>{st.log_tail}</pre>}
            </article>
          ))}
          <p className="hint">Файлы прогона: {report.work_dir}</p>
        </div>
      )}
    </section>
  );
}
