import { currentSelection, useEditor } from '../state/store';
import { HOTKEYS } from '../state/useHotkeys';
import { WayInspector } from './WayInspector';
import { NodeInspector } from './NodeInspector';

function Nothing() {
  return (
    <div className="insp-empty">
      <div className="insp-empty-mark" aria-hidden="true" />
      <p>Ничего не выбрано</p>
      <p className="hint">Кликните дорогу или узел на карте либо улицу в списке слева.</p>
      <details className="hotkeys">
        <summary className="micro">Горячие клавиши</summary>
        <dl>{HOTKEYS.map(([k, v]) => <div key={k}><dt className="mono">{k}</dt><dd>{v}</dd></div>)}</dl>
      </details>
    </div>
  );
}

export function Inspector() {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => currentSelection(s));
  return (
    <aside className="panel inspector-panel" aria-label="Инспектор">
      <div className="panel-title micro">Инспектор</div>
      <div key={selection ? `${selection.type}${selection.id}` : 'none'} className="insp-swap">
        {selection?.type === 'way' && <WayInspector way={doc.ways[selection.id]} />}
        {selection?.type === 'node' && <NodeInspector node={doc.nodes[selection.id]} />}
        {!selection && <Nothing />}
      </div>
    </aside>
  );
}
