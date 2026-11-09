import { useMemo } from 'react';
import { currentSelection, useEditor } from '../state/store';
import { MultiInspector } from './MultiInspector';
import { HOTKEYS } from '../state/useHotkeys';
import { WayInspector } from './WayInspector';
import { NodeInspector } from './NodeInspector';
import { BuildingInspector } from './BuildingInspector';
import { StreetInspector } from './StreetInspector';
import { isBuildingWay } from '../osm/building';
import { Why } from './Why';

function Nothing() {
  return (
    <div className="insp-empty">
      <div className="insp-empty-mark" aria-hidden="true" />
      <p>Ничего не выбрано</p>
      <p className="hint">Кликните дорогу, узел или здание на карте либо улицу в списке слева. Рамка с Shift выбирает несколько.</p>
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
  const rawMulti = useEditor((s) => s.multi);
  const multi = useMemo(() => rawMulti.filter((id) => doc.ways[id]), [rawMulti, doc]);
  return (
    <aside className="panel inspector-panel" aria-label="Инспектор" data-tour="inspector">
      <div className="panel-title micro"><span>Инспектор</span><Why id="inspector" /></div>
      <div key={multi.length > 1 ? `multi${multi.length}` : selection ? `${selection.type}${selection.id}` : 'none'} className="insp-swap">
        {multi.length > 1 && <MultiInspector ids={multi} />}
        {multi.length < 2 && selection?.type === 'way' && (isBuildingWay(doc.ways[selection.id])
          ? <BuildingInspector way={doc.ways[selection.id]} />
          : <WayInspector way={doc.ways[selection.id]} />)}
        {multi.length < 2 && selection?.type === 'node' && <NodeInspector node={doc.nodes[selection.id]} />}
        {multi.length < 2 && selection?.type === 'street' && <StreetInspector name={selection.id} />}
        {multi.length < 2 && !selection && <Nothing />}
      </div>
    </aside>
  );
}
