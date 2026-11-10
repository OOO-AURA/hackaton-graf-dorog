import { logText, useErrorLog } from '../state/errorLog';
import { useEditor } from '../state/store';
import { useUi } from '../state/ui';
import { saveTextFile } from '../platform';

const time = (ms: number) => new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Bottom tab «Ошибки»: the session's error log, newest first. */
export function ErrorLogPanel() {
  const entries = useErrorLog((s) => s.entries);
  const clear = useErrorLog((s) => s.clear);
  const focusIssue = useEditor((s) => s.setFocusIssue);
  const flyTo = useUi((s) => s.flyTo);
  if (!entries.length) return <p className="hint dock-empty">Ошибок пока не было. Сюда попадают сбои приложения (загрузка, SUMO, сохранение) и ошибки графа: когда правка их внесла и когда исправила.</p>;
  const open = entries.filter((e) => e.kind === 'graph' && !e.fixedAt).length;
  return (
    <section className="error-log">
      <div className="error-log-head">
        <span className="hint">Всего {entries.length}, ошибок графа не исправлено: {open}</span>
        <button className="btn btn-sm" onClick={() => void saveTextFile(logText(entries), 'hack-team10-errors.txt', 'Текст', 'txt')}>Скачать журнал</button>
        <button className="btn btn-sm btn-quiet" onClick={clear}>Очистить</button>
      </div>
      <ol className="error-log-list">
        {[...entries].reverse().map((e) => (
          <li key={e.id} className={`${e.kind}${e.fixedAt ? ' fixed' : ''}`}>
            <span className="mono">{time(e.time)}</span>
            <span className="error-kind">{e.kind === 'app' ? 'приложение' : e.fromFile ? 'граф, в файле' : 'граф, после правки'}</span>
            {e.at ? (
              <button className="link" onClick={() => {
                if (e.issueId) focusIssue(e.issueId);
                const [lon, lat] = e.at!;
                flyTo([lon - 0.0008, lat - 0.0005, lon + 0.0008, lat + 0.0005]);
              }}>{e.message}</button>
            ) : <span>{e.message}</span>}
            <span className="error-status">{e.kind === 'graph' ? (e.fixedAt ? `исправлено ${time(e.fixedAt)}` : 'не исправлено') : ''}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
