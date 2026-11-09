import { connectCrossing, mergeNodes } from '../osm/edit';
import type { Issue } from '../osm/validate';
import { useEditor } from '../state/store';
import { closeCordon } from '../state/actions';
import { cordonPairs } from '../osm/cordon';

const KIND_LABELS: Readonly<Record<Issue['kind'], string>> = {
  isolated: 'Изолированные участки', trap: 'Тупики по направлению', cordon: 'Обрезано границей фрагмента', crossing: 'Пересечения без узла', 'near-nodes': 'Разорванные перекрёстки',
};

function applyFix(issue: Issue): void {
  const { apply, runValidation } = useEditor.getState();
  const fix = issue.fix;
  if (!fix) return;
  apply((d) => (fix.type === 'merge' ? mergeNodes(d, fix.keep, fix.remove) : connectCrossing(d, fix.a, fix.b, fix.at[0], fix.at[1])));
  runValidation();
}

export { KIND_LABELS };

export function IssuesPanel() {
  const report = useEditor((s) => s.report);
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
      {!report && <p className="hint">Проверяю связность, направления, разорванные и склеенные перекрёстки…</p>}
      {report && (
        <>
          {report.issues.length === 0 && <p className="ok">Ошибок не найдено</p>}
          <CordonHint />
          {(Object.keys(KIND_LABELS) as Issue['kind'][]).map((kind) => {
            const items = report.issues.filter((i) => i.kind === kind);
            if (!items.length) return null;
            return (
              <details key={kind} open={items.length <= 8}>
                <summary><span>{KIND_LABELS[kind]}</span><span className="mono count">{items.length}</span></summary>
                <ul>
                  {items.map((issue) => (
                    <li key={issue.id} className={`${issue.severity}${issue.id === focus ? ' focused' : ''}`}>
                      <button className="issue-link" onClick={() => open(issue)}>{issue.message}</button>
                      {issue.fix && <button className="btn btn-sm fix" onClick={() => applyFix(issue)}>Исправить</button>}
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

/** Offers to join cut carriageways at the fragment edge when the check found such roads. */
function CordonHint() {
  const doc = useEditor((s) => s.doc);
  const hasCordonIssues = useEditor((s) => s.report?.issues.some((i) => i.kind === 'cordon') ?? false);
  if (!hasCordonIssues) return null;
  const pairs = cordonPairs(doc).length;
  if (!pairs) return null;
  return (
    <p className="hint cordon-hint">
      Найдено разрезанных границей двусторонних дорог: {pairs}. Кордонный разворот соединяет их проезжие части за краем фрагмента,
      и MATSim перестаёт выкидывать эти дороги из сети.{' '}
      <button className="btn btn-sm fix" onClick={closeCordon}>Замкнуть кордон</button>
    </p>
  );
}
