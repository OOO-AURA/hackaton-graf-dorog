import { useMacro, VC_BANDS } from '../macro/store';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useMemo, useState } from 'react';
import { docBounds } from '../map/geojson';
import { useEditor } from '../state/store';
import { builtPoints, drawingConflicts, finishDrawing } from '../state/actions';
import { useUi } from '../state/ui';
import { ROAD_TEMPLATES } from '../osm/tags';
import { Icon } from './icons';
import { TOOLS } from './tools';
import { PresetDock } from './PresetDock';
import { TOOLS_IN } from '../map/editScope';
import { EmptyState } from './EmptyState';
import { SimBar } from './sim/SimBar';
import { HeightHandle } from './HeightHandle';
import { useBuildingTool } from '../map/buildingTool';
import { BUILDING_TEMPLATES } from '../osm/buildingShape';
import { MapHint } from './MapHint';
import { ViewNote } from './ViewNote';

/** Template picker and hints of the building tool, next to the tools. */
function BuildingBar() {
  const template = useBuildingTool((s) => s.template);
  const setTemplate = useBuildingTool((s) => s.setTemplate);
  const ghost = useBuildingTool((s) => s.ghost);
  return (
    <div className="float float-draw float-building">
      <div className="seg" role="radiogroup" aria-label="Шаблон здания">
        {BUILDING_TEMPLATES.map((t, i) => (
          <button key={t.id} role="radio" aria-checked={template === i} className={template === i ? 'on' : ''} onClick={() => setTemplate(i)}
            title={`${t.width}×${t.length} м, ${t.levels} эт. (${i + 1})`}>
            <kbd>{i + 1}</kbd>{t.label}
          </button>
        ))}
      </div>
      <span className={`building-hint${ghost?.onRoad ? ' warn' : ''}`}>
        {ghost?.onRoad ? 'На дороге' : ghost?.aligned ? 'Вдоль дороги' : 'Свободно'}
      </span>
    </div>
  );
}

function FloatingTools() {
  const mode = useEditor((s) => s.mode);
  const setMode = useEditor((s) => s.setMode);
  const lens = useUi((s) => s.lens);
  const template = useEditor((s) => s.templateIndex);
  const points = useEditor((s) => s.drawing.length);
  const drawing = useEditor((s) => s.drawing);
  const doc = useEditor((s) => s.doc);
  // Only the points already placed, rounded as they will be built: that is what Enter would build.
  const conflicts = useMemo(() => {
    if (mode !== 'draw' || drawing.length < 2) return [];
    const tags = ROAD_TEMPLATES[template].tags;
    return drawingConflicts(doc, builtPoints(drawing, tags), tags);
  }, [mode, drawing, doc, template]);
  return (
    <>
      <div className="float float-tools" role="toolbar" aria-label="Инструменты" aria-orientation="vertical">
        {TOOLS.map((t) => (
          <button key={t.mode} className={`tool tool-labelled${mode === t.mode ? ' on' : ''}`} onClick={() => setMode(t.mode)} aria-pressed={mode === t.mode}
            disabled={!TOOLS_IN[lens].has(t.mode)} title={TOOLS_IN[lens].has(t.mode) ? t.hint : `${t.label}: не нужен в этом режиме вида`}>
            <Icon name={t.icon} size={18} /><span>{t.label}</span><kbd>{t.key}</kbd>
          </button>
        ))}
      </div>
      <PresetDock />
      {mode === 'building' && <BuildingBar />}
      {mode === 'draw' && (
        <div className="float float-draw">
          <DrawShape />
          <button className="btn btn-ink" onClick={() => finishDrawing()} disabled={points < 2 || conflicts.length > 0}>Готово <kbd>Enter</kbd></button>
        </div>
      )}
      {conflicts.length > 0 && (
        <div className="float float-conflict" role="group" aria-label="Здания на пути дороги">
          <b>{conflicts.length === 1 ? 'Дорога задевает здание' : `Дорога задевает здания: ${conflicts.length}`}</b>
          <div className="buttons">
            <button className="btn btn-sm btn-ink" onClick={() => finishDrawing('cut')} title="Часть здания под дорогой убирается, остальное остаётся с теми же тегами; здание, разрезанное пополам, становится двумя">Срезать по дороге</button>
            <button className="btn btn-sm" onClick={() => finishDrawing('demolish')}>Снести</button>
            <button className="btn btn-sm btn-quiet" onClick={() => finishDrawing('keep')} title="Например, проезд под зданием, в арке">Построить поверх</button>
          </div>
        </div>
      )}
    </>
  );
}

const SNAP_TEXT = { node: 'к узлу', way: 'к дороге', angle: 'ровный угол' } as const;

/** Straight or curved road, and the length and turn of the segment under the pointer. */
function DrawShape() {
  const curve = useUi((s) => s.drawCurve);
  const toggle = useUi((s) => s.toggleDrawCurve);
  const target = useUi((s) => s.drawTarget);
  const control = useUi((s) => s.curveControl);
  const points = useEditor((s) => s.drawing.length);
  const turn = target?.turn;
  const readout = [
    target?.length ? `${Math.round(target.length)} м` : '',
    turn !== null && turn !== undefined ? `${turn > 0 ? 'вправо' : turn < 0 ? 'влево' : 'прямо'} ${Math.abs(Math.round(turn))}°` : '',
    target?.snap ? SNAP_TEXT[target.snap] : '',
  ].filter(Boolean).join(' · ');
  const hint = curve ? (!points ? 'клик — начало' : control ? 'клик — конец дуги' : 'клик — куда изогнуть') : 'Shift — шаг 15°';
  return (
    <>
      <span className="seg" role="radiogroup" aria-label="Форма дороги">
        <button role="radio" aria-checked={!curve} className={!curve ? 'on' : ''} onClick={() => curve && toggle()} title="Отрезки; угол сам встаёт на 15°, 30°, 45°, 60°, 90°">Прямая</button>
        <button role="radio" aria-checked={curve} className={curve ? 'on' : ''} onClick={() => !curve && toggle()} title="Дуга по трём кликам: начало, изгиб, конец. Изгиб далеко вперёд и конец рядом с началом дают разворот">Кривая</button>
      </span>
      <span className="draw-readout mono" aria-live="polite">{readout || hint}</span>
    </>
  );
}

function ZoomControls({ map }: { map: MapLibreMap | null }) {
  const view3d = useUi((s) => s.view3d);
  const toggle3d = useUi((s) => s.toggle3d);
  // The north arrow turns with the map, so it doubles as a compass.
  const [bearing, setBearing] = useState(0);
  useEffect(() => {
    if (!map) return undefined;
    const sync = () => setBearing(map.getBearing());
    sync();
    map.on('rotate', sync);
    return () => { map.off('rotate', sync); };
  }, [map]);
  const fit = () => {
    const b = docBounds(useEditor.getState().doc);
    if (b) useUi.getState().flyTo(b);
  };
  return (
    <div className="float float-zoom" role="group" aria-label="Масштаб">
      <button className="tool" onClick={() => map?.zoomIn()} title="Приблизить"><Icon name="plus" /></button>
      <button className="tool" onClick={() => map?.zoomOut()} title="Отдалить"><Icon name="minus" /></button>
      <button className="tool" onClick={fit} title="Весь граф"><Icon name="fit" /></button>
      <button className="tool" onClick={() => map?.resetNorth()} title="На север"><span className="compass" style={{ transform: `rotate(${-bearing}deg)` }}><Icon name="north" /></span></button>
      <button className={`tool tool-3d${view3d ? ' on' : ''}`} onClick={toggle3d} title="2D / 3D (P)" aria-pressed={view3d}>{view3d ? '3D' : '2D'}</button>
    </div>
  );
}

/** Legend of the load lens: v/c bands, and a note while the assignment runs. */
function LoadLegend() {
  const on = useUi((s) => s.lens === 'load');
  const busy = useMacro((s) => s.busy);
  const result = useMacro((s) => s.result);
  const error = useMacro((s) => s.error);
  if (!on) return null;
  return (
    <div className="float float-load" role="status">
      <b>Загрузка, V/C</b>
      {busy && <span className="hint">Распределяю потоки…</span>}
      {error && <span className="hint err">{error}</span>}
      {!busy && result && <ul>{VC_BANDS.map((b) => <li key={b.label}><i style={{ background: b.color }} />{b.label}</li>)}</ul>}
      {!busy && result && <button className="btn btn-sm" onClick={() => void useMacro.getState().run()}>Пересчитать</button>}
    </div>
  );
}

export function MapOverlay({ map }: { map: MapLibreMap | null }) {
  const empty = useEditor((s) => !Object.keys(s.doc.nodes).length);
  const micro = useUi((s) => s.workspace === 'micro');
  if (empty) return <EmptyState />;
  return (
    <>
      {micro ? <SimBar /> : <FloatingTools />}
      {!micro && <HeightHandle map={map} />}
      <ViewNote />
      <LoadLegend />
      <ZoomControls map={map} />
      {!micro && <MapHint />}
    </>
  );
}
