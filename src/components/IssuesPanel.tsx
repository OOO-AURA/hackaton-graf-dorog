import { connectCrossing, mergeNodes } from '../osm/edit';
import type { Issue } from '../osm/validate';
import { useEditor } from '../state/store';

const KIND_LABELS: Readonly<Record<Issue['kind'], string>> = {
  isolated: 'Изолированные участки', trap: 'Тупики по направлению', crossing: 'Пересечения без узла', 'near-nodes': 'Разорванные перекрёстки',
};

function applyFix(issue: Issue): void {
  const { apply, runValidation } = useEditor.getState();
  const fix = issue.fix;
  if (!fix) return;
  apply((d) => (fix.type === 'merge' ? mergeNodes(d, fix.keep, fix.remove) : connectCrossing(d, fix.a, fix.b, fix.at[0], fix.at[1])));
  runValidation();
}

export function IssuesPanel() {
  const report = useEditor((s) => s.report);
  const runValidation = useEditor((s) => s.runValidation);
  const focus = useEditor((s) => s.focusIssue);
  const setFocus = useEditor((s) => s.setFocusIssue);
  const select = useEditor((s) => s.select);

  const open = (issue: Issue) => {
    setFocus(issue.id);
    if (issue.wayIds[0]) select({ type: 'way', id: issue.wayIds[0] });
    else if (issue.nodeIds[0]) select({ type: 'node', id: issue.nodeIds[0] });
  };

  return (
    <div className="issues">
      <div className="issues-head">
        <h3>Проверка графа</h3>
        <button onClick={() => runValidation()}>{report ? 'Обновить' : 'Проверить'}</button>
      </div>
      {!report && <p className="hint">Связность, направления, разорванные и склеенные перекрёстки. Запускается и перед сохранением.</p>}
      {report && (
        <>
          <p className="stats">
            {report.stats.ways} дорог · {report.stats.lengthKm.toFixed(1)} км · {report.stats.signals} светофоров · компонент связности: {report.stats.components}
          </p>
          {report.issues.length === 0 && <p className="ok">Ошибок не найдено ✓</p>}
          {(Object.keys(KIND_LABELS) as Issue['kind'][]).map((kind) => {
            const items = report.issues.filter((i) => i.kind === kind);
            if (!items.length) return null;
            return (
              <details key={kind} open={items.length <= 8}>
                <summary>{KIND_LABELS[kind]} — {items.length}</summary>
                <ul>
                  {items.map((issue) => (
                    <li key={issue.id} className={`${issue.severity}${issue.id === focus ? ' focused' : ''}`}>
                      <button className="link" onClick={() => open(issue)}>{issue.message}</button>
                      {issue.fix && <button className="fix" onClick={() => applyFix(issue)}>Исправить</button>}
                    </li>
                  ))}
                </ul>
              </details>
            );
          })}
        </>
      )}
    </div>
  );
}
