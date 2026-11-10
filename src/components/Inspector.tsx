import { useMemo } from 'react';
import { currentSelection, useEditor } from '../state/store';
import { MultiInspector } from './MultiInspector';
import { useUi } from '../state/ui';
import { Icon } from './icons';
import { WayInspector } from './WayInspector';
import { NodeInspector } from './NodeInspector';
import { BuildingInspector } from './BuildingInspector';
import { StreetInspector } from './StreetInspector';
import { isBuildingWay } from '../osm/building';
import { Why } from './Why';
import { RailInspector, StationInspector } from './RailInspector';
import { isRailWay, stationKind } from '../osm/rail';
import { useSettledDoc } from '../state/settled';
import { RoadCatalog, SignPalette } from './ToolCatalog';
import { ROAD_TEMPLATES } from '../osm/tags';
import { finishDrawing } from '../state/actions';

/** First things to do, as buttons: what the editor is for when nothing is selected yet. */
const STARTS = [
  { mode: 'draw', icon: 'road', title: 'Нарисовать дорогу', text: 'Точки кликами, Enter заканчивает', key: 'D' },
  { mode: 'signal', icon: 'signal', title: 'Светофор или знак', text: 'Клик по узлу ставит объект ОДД', key: 'T' },
  { mode: 'building', icon: 'building', title: 'Поставить здание', text: 'Само встаёт вдоль дороги', key: 'B' },
  { mode: 'insert', icon: 'node', title: 'Узел на дороге', text: 'Для изгиба или перекрёстка', key: 'N' },
] as const;

function Nothing() {
  const setMode = useEditor((s) => s.setMode);
  const setStep = useUi((s) => s.setStep);
  const setHelpOpen = useUi((s) => s.setHelpOpen);
  const errors = useEditor((s) => s.report?.issues.filter((i) => i.severity === 'error').length ?? 0);
  return (
    <div className="insp-empty">
      <h3 className="insp-start-title">С чего начать</h3>
      <p className="hint">Кликните дорогу, перекрёсток или здание на карте, и здесь появятся его свойства. Или выберите действие:</p>
      <div className="insp-starts">
        {STARTS.map((s) => (
          <button key={s.mode} className="insp-start" onClick={() => setMode(s.mode)}>
            <Icon name={s.icon} size={18} />
            <span><b>{s.title}</b><span className="hint">{s.text}</span></span>
            <kbd>{s.key}</kbd>
          </button>
        ))}
      </div>
      {errors > 0 && (
        <button className="insp-start insp-start-warn" onClick={() => setStep('check')}>
          <Icon name="check" size={18} />
          <span><b>Исправить ошибки графа: {errors}</b><span className="hint">Шаг 2, многие чинятся одной кнопкой</span></span>
        </button>
      )}
      <button className="link insp-help" onClick={() => setHelpOpen(true)}>Как работать и горячие клавиши <kbd>?</kbd></button>
    </div>
  );
}

/** While a road is drawn or signs are placed, the inspector is the catalogue for that tool. */
function ToolPane({ mode }: { mode: 'draw' | 'signal' }) {
  const setMode = useEditor((s) => s.setMode);
  const points = useEditor((s) => s.drawing.length);
  const template = useEditor((s) => s.templateIndex);
  return (
    <div className="tool-pane">
      <div className="tool-pane-head">
        <div>
          <span className="micro">Инструмент</span>
          <h3>{mode === 'draw' ? 'Новая дорога' : 'Знаки и объекты ОДД'}</h3>
        </div>
        <button className="icon-btn" onClick={() => setMode('select')} aria-label="Закрыть инструмент" title="Esc">✕</button>
      </div>
      {mode === 'draw' && (
        <div className="tool-pane-status">
          <span><b>{ROAD_TEMPLATES[template].label}</b> · точек: <span className="mono">{points}</span></span>
          <button className="btn btn-sm btn-ink" onClick={finishDrawing} disabled={points < 2}>Готово <kbd>Enter</kbd></button>
        </div>
      )}
      {mode === 'draw' ? <RoadCatalog /> : <SignPalette />}
    </div>
  );
}

export function Inspector() {
  const mode = useEditor((s) => s.mode);
  const doc = useSettledDoc();
  const selection = useEditor((s) => currentSelection(s));
  const rawMulti = useEditor((s) => s.multi);
  const multi = useMemo(() => rawMulti.filter((id) => doc.ways[id]), [rawMulti, doc]);
  return (
    <aside className="panel inspector-panel" aria-label="Инспектор" data-tour="inspector">
      <div className="panel-title micro"><span>Инспектор</span><Why id="inspector" /></div>
      {(mode === 'draw' || mode === 'signal') && <ToolPane mode={mode} />}
      {mode !== 'draw' && mode !== 'signal' && <div key={multi.length > 1 ? `multi${multi.length}` : selection ? `${selection.type}${selection.id}` : 'none'} className="insp-swap">
        {multi.length > 1 && <MultiInspector ids={multi} />}
        {multi.length < 2 && selection?.type === 'way' && (isBuildingWay(doc.ways[selection.id])
          ? <BuildingInspector way={doc.ways[selection.id]} />
          : isRailWay(doc.ways[selection.id].tags) ? <RailInspector way={doc.ways[selection.id]} />
          : <WayInspector way={doc.ways[selection.id]} />)}
        {multi.length < 2 && selection?.type === 'node' && (stationKind(doc.nodes[selection.id].tags)
          ? <StationInspector node={doc.nodes[selection.id]} />
          : <NodeInspector node={doc.nodes[selection.id]} />)}
        {multi.length < 2 && selection?.type === 'street' && <StreetInspector name={selection.id} />}
        {multi.length < 2 && !selection && <Nothing />}
      </div>}
    </aside>
  );
}
