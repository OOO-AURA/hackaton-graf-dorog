import type { Map as MapLibreMap } from 'maplibre-gl';
import { docBounds } from '../map/geojson';
import { useEditor, type Basemap } from '../state/store';
import { finishDrawing } from '../state/actions';
import { LAYER_IDS, useUi, type LayerId } from '../state/ui';
import { ROAD_TEMPLATES } from '../osm/tags';
import { Icon } from './icons';
import { TOOLS } from './tools';
import { EmptyState } from './EmptyState';
import { SimBar } from './sim/SimBar';

const BASEMAPS: ReadonlyArray<[Basemap, string]> = [['osm', 'Схема'], ['satellite', 'Спутник'], ['none', 'Нет']];

export const LAYER_LABELS: Readonly<Record<LayerId, string>> = {
  roads: 'Дороги', junctions: 'Перекрёстки', signals: 'Светофоры', crossings: 'Переходы',
  bridges: 'Мосты', tunnels: 'Тоннели', buildings: 'Здания', tram: 'Трамвай', signs: 'Неровности', transit: 'Маршруты ОТ',
};

function FloatingTools() {
  const mode = useEditor((s) => s.mode);
  const setMode = useEditor((s) => s.setMode);
  const template = useEditor((s) => s.templateIndex);
  const setTemplate = useEditor((s) => s.setTemplate);
  const points = useEditor((s) => s.drawing.length);
  return (
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
          <button className="btn btn-ink" onClick={finishDrawing} disabled={points < 2}>Готово <kbd>Enter</kbd></button>
        </div>
      )}
    </div>
  );
}

function ZoomControls({ map }: { map: MapLibreMap | null }) {
  const view3d = useUi((s) => s.view3d);
  const toggle3d = useUi((s) => s.toggle3d);
  const fit = () => {
    const b = docBounds(useEditor.getState().doc);
    if (b) useUi.getState().flyTo(b);
  };
  return (
    <div className="float float-zoom" role="group" aria-label="Масштаб">
      <button className="tool" onClick={() => map?.zoomIn()} title="Приблизить"><Icon name="plus" /></button>
      <button className="tool" onClick={() => map?.zoomOut()} title="Отдалить"><Icon name="minus" /></button>
      <button className="tool" onClick={fit} title="Весь граф"><Icon name="fit" /></button>
      <button className="tool" onClick={() => map?.resetNorth()} title="На север"><Icon name="north" /></button>
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
      <ZoomControls map={map} />
      <BasemapSwitch />
      <LayerBar />
    </>
  );
}
