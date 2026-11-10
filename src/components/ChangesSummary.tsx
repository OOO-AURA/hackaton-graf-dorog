import { useMemo } from 'react';
import { diffMarkdown, docDiff, isEmptyDiff } from '../osm/diff';
import { saveTextFile } from '../platform';
import { useEditor } from '../state/store';
import { useUi } from '../state/ui';
import { useSettledDoc } from '../state/settled';

/** Changes against the opened file: counts, the map layer toggle and a Markdown change list. */
export function ChangesSummary() {
  const doc = useSettledDoc();
  const base = useEditor((s) => s.baseDoc);
  const saveName = useEditor((s) => s.saveName);
  const shown = useUi((s) => s.layers.changes);
  const toggleLayer = useUi((s) => s.toggleLayer);
  const diff = useMemo(() => docDiff(base, doc), [base, doc]);
  if (isEmptyDiff(diff)) return null;
  const count = (kind: string) => diff.ways.filter((w) => w.kind === kind).length;
  const exportList = () => {
    const stem = (saveName.trim() || 'graph').replace(/\.osm$/i, '');
    void saveTextFile(diffMarkdown(diff, base, doc, `${stem}.osm`), `${stem}-changes.md`, 'Markdown', 'md');
  };
  return (
    <div className="changes-summary">
      <span className="micro">По сравнению с открытым файлом</span>
      <span className="mono">линий: +{count('added')} −{count('deleted')}, изменено {count('geometry') + count('tags')} · узлов {diff.nodes.length} · отношений +{diff.relationsAdded} −{diff.relationsDeleted}</span>
      <div className="buttons">
        <button className="btn btn-sm" aria-pressed={shown} onClick={() => toggleLayer('changes')}>{shown ? 'Скрыть на карте' : 'Показать на карте'}</button>
        <button className="btn btn-sm" onClick={exportList}>Список изменений, .md</button>
      </div>
    </div>
  );
}
