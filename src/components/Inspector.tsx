import { useMemo } from 'react';
import { currentSelection, useEditor } from '../state/store';
import { MultiInspector } from './MultiInspector';
import { useUi } from '../state/ui';
import { Icon } from './icons';
import { WayInspector } from './WayInspector';
import { NodeInspector } from './NodeInspector';
import { BuildingInspector } from './BuildingInspector';
import { ParkingInspector } from './ParkingInspector';
import { isParkingArea } from '../osm/parking';
import { StreetInspector } from './StreetInspector';
import { isBuildingWay } from '../osm/building';
import { Why } from './Why';
import { RailInspector, StationInspector } from './RailInspector';
import { isRailWay, stationKind } from '../osm/rail';
import { useSettledDoc } from '../state/settled';
import { signDef } from '../osm/trafficSigns';
import { NODE_FEATURES } from '../map/features';
import { ROAD_TEMPLATES } from '../osm/tags';
import { finishDrawing } from '../state/actions';

/** Nothing selected: one line on what to do and the way to the reference, where the first steps are. */
function Nothing() {
  const setHelpOpen = useUi((s) => s.setHelpOpen);
  return (
    <div className="insp-empty">
      <p className="hint">Кликните дорогу, перекрёсток или здание на карте, и здесь появятся его свойства.</p>
      <button className="link insp-help" onClick={() => setHelpOpen(true, 'welcome')}>С чего начать и горячие клавиши <kbd>?</kbd></button>
    </div>
  );
}

/** While a road is drawn or signs are placed, the inspector is the catalogue for that tool. */
/** What the T tool puts now, and how: a sign sticks to the road edge on the side of the cursor. */
function SignStatus() {
  const kind = useUi((s) => s.featureKind);
  const def = kind.startsWith('ts:') ? signDef(kind.slice(3)) : null;
  const feature = def ? null : NODE_FEATURES.find((f) => f.id === kind);
  return (
    <div className="tool-pane-status">
      <span><b>{def ? `${def.code.startsWith('signal') ? '' : `${def.code} `}${def.name}` : feature?.label}</b></span>
      <p className="hint">{def
        ? 'Ведите по карте: знак прилипает к ближней дороге и встаёт у её края. С какой стороны дороги курсор, для того направления движения и знак. Клик ставит.'
        : feature?.hint}</p>
    </div>
  );
}

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
      {mode === 'signal' && <SignStatus />}
      <p className="hint">Заготовки — в капсуле внизу карты: {mode === 'draw' ? 'вкладка «Дороги»' : 'вкладка «Знаки и ОДД»'}.</p>
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
      {mode === 'view' && <p className="insp-viewonly"><Icon name="eye" size={14} /> Просмотр: поля только для чтения</p>}
      {mode !== 'draw' && mode !== 'signal' && <fieldset disabled={mode === 'view'} key={multi.length > 1 ? `multi${multi.length}` : selection ? `${selection.type}${selection.id}` : 'none'} className="insp-swap">
        {multi.length > 1 && <MultiInspector ids={multi} />}
        {multi.length < 2 && selection?.type === 'way' && (isParkingArea(doc.ways[selection.id])
          ? <ParkingInspector way={doc.ways[selection.id]} />
          : isBuildingWay(doc.ways[selection.id])
          ? <BuildingInspector way={doc.ways[selection.id]} />
          : isRailWay(doc.ways[selection.id].tags) ? <RailInspector way={doc.ways[selection.id]} />
          : <WayInspector way={doc.ways[selection.id]} />)}
        {multi.length < 2 && selection?.type === 'node' && (stationKind(doc.nodes[selection.id].tags)
          ? <StationInspector node={doc.nodes[selection.id]} />
          : <NodeInspector node={doc.nodes[selection.id]} />)}
        {multi.length < 2 && selection?.type === 'street' && <StreetInspector name={selection.id} />}
        {multi.length < 2 && !selection && <Nothing />}
      </fieldset>}
    </aside>
  );
}
