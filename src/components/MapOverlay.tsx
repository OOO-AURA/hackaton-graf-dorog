import type { Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useMemo, useState } from 'react';
import { docBounds } from '../map/geojson';
import { useEditor, type Basemap } from '../state/store';
import { drawingConflicts, finishDrawing } from '../state/actions';
import { LAYER_IDS, useUi, type LayerId } from '../state/ui';
import { THEMATIC, type RoadColorMode } from '../map/thematic';
import { ROAD_TEMPLATES } from '../osm/tags';
import { Icon } from './icons';
import { TOOLS } from './tools';
import { EmptyState } from './EmptyState';
import { SimBar } from './sim/SimBar';
import { HeightHandle } from './HeightHandle';
import { JunctionCard } from './JunctionCard';

const BASEMAPS: ReadonlyArray<[Basemap, string]> = [['osm', 'Схема'], ['satellite', 'Спутник'], ['none', 'Нет']];

export const LAYER_LABELS: Readonly<Record<LayerId, string>> = {
  roads: 'Дороги', junctions: 'Перекрёстки', signals: 'Светофоры', crossings: 'Переходы',
  bridges: 'Мосты', tunnels: 'Тоннели', buildings: 'Здания', tram: 'Ж/д и трамвай', signs: 'Знаки', transit: 'Маршруты ОТ', changes: 'Изменения',
};

function FloatingTools() {
  const mode = useEditor((s) => s.mode);
  const setMode = useEditor((s) => s.setMode);
  const template = useEditor((s) => s.templateIndex);
  const setTemplate = useEditor((s) => s.setTemplate);
  const points = useEditor((s) => s.drawing.length);
  const drawing = useEditor((s) => s.drawing);
  const doc = useEditor((s) => s.doc);
  // Only the points already placed: that is what Enter would build.
  const conflicts = useMemo(() => (mode === 'draw' && drawing.length > 1 ? drawingConflicts(doc, drawing, ROAD_TEMPLATES[template].tags) : []), [mode, drawing, doc, template]);
  return (
    <>
      <div className="float float-tools" role="toolbar" aria-label="Инструменты">
        {TOOLS.map((t) => (
          <button key={t.mode} className={`tool${mode === t.mode ? ' on' : ''}`} onClick={() => setMode(t.mode)} title={`${t.label} (${t.key})`} aria-pressed={mode === t.mode}>
            <Icon name={t.icon} size={18} />
          </button>
        ))}
        {mode === 'draw' && (
          <div className="float-draw">
            <select value={template} onChange={(e) => setTemplate(Number(e.target.value))} aria-label="Шаблон дороги">
              {ROAD_TEMPLATES.map((t, i) => <option key={t.label} value={i}>{i + 1} · {t.label}</option>)}
            </select>
            <button className="btn btn-ink" onClick={() => finishDrawing()} disabled={points < 2 || conflicts.length > 0}>Готово <kbd>Enter</kbd></button>
          </div>
        )}
      </div>
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

function BasemapSwitch() {
  const basemap = useEditor((s) => s.basemap);
  const setBasemap = useEditor((s) => s.setBasemap);
  const opacity = useUi((s) => s.basemapOpacity);
  const setOpacity = useUi((s) => s.setBasemapOpacity);
  return (
    <div className="float float-basemap">
      <div className="seg" role="radiogroup" aria-label="Подложка">
        {BASEMAPS.map(([v, l]) => (
          <button key={v} role="radio" aria-checked={basemap === v} className={basemap === v ? 'on' : ''} onClick={() => setBasemap(v)}>{l}</button>
        ))}
      </div>
      <label className="blend" title="Насколько видна подложка под графом">
        <span>граф</span>
        <input type="range" min={0} max={1} step={0.05} value={opacity} disabled={basemap === 'none'} onChange={(e) => setOpacity(Number(e.target.value))} aria-label="Прозрачность подложки" />
        <span>карта</span>
      </label>
    </div>
  );
}

const COLOR_MODES: ReadonlyArray<readonly [RoadColorMode, string]> = [
  ['class', 'Цвет: класс дороги'], ['lanes', 'Цвет: полосы'], ['speed', 'Цвет: скорость'], ['capacity', 'Цвет: пропускная'], ['missing', 'Цвет: пропуски атрибутов'],
];

/** Road colour by one attribute, with its legend; makes lane jumps and gaps in the data visible. */
function ColorModeSwitch() {
  const mode = useUi((s) => s.roadColorMode);
  const setMode = useUi((s) => s.setRoadColorMode);
  const bands = mode === 'class' ? null : THEMATIC[mode].bands;
  return (
    <div className="float float-colormode">
      <select value={mode} onChange={(e) => setMode(e.target.value as RoadColorMode)} aria-label="Чем красить дороги">
        {COLOR_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {bands && <ul className="thematic-legend">{bands.map((b) => <li key={b.label}><i style={{ background: b.color }} />{b.label}</li>)}</ul>}
    </div>
  );
}

const LOOKS = [['engineering', 'Инженерия'], ['graph', 'Граф']] as const;

/** Engineering plan (asphalt, markings, turn ribbons) or a graph coloured by road class. */
function LookSwitch() {
  const look = useUi((s) => s.roadLook);
  const setLook = useUi((s) => s.setRoadLook);
  return (
    <div className="float float-look seg" role="radiogroup" aria-label="Вид дорог">
      {LOOKS.map(([v, label]) => (
        <button key={v} role="radio" aria-checked={look === v} className={look === v ? 'on' : ''} onClick={() => setLook(v)}>{label}</button>
      ))}
    </div>
  );
}

function LayerBar() {
  const layers = useUi((s) => s.layers);
  const toggle = useUi((s) => s.toggleLayer);
  return (
    <div className="float float-layers" role="group" aria-label="Видимость слоёв">
      {LAYER_IDS.map((id) => (
        <button key={id} className={`layer-chip l-${id}${layers[id] ? ' on' : ''}`} aria-pressed={layers[id]} onClick={() => toggle(id)}>
          <i aria-hidden="true" />{LAYER_LABELS[id]}
        </button>
      ))}
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
      {!micro && <LookSwitch />}
      {!micro && <JunctionCard />}
      <ZoomControls map={map} />
      <BasemapSwitch />
      <ColorModeSwitch />
      <LayerBar />
    </>
  );
}
