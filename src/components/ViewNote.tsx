import { useUi } from '../state/ui';
import { useEditor } from '../state/store';
import { LENSES } from '../map/lens';
import { THEMATIC } from '../map/thematic';
import { COLOR_MODES, LOOKS, openViewSettings, pickLens } from './ViewSettings';
import { Icon } from './icons';

/**
 * Top of the map: how it looks now, as one button that opens the view settings, and a ✕ on
 * every choice away from the usual look, so a strange-looking map always has a way back.
 */
export function ViewNote() {
  const micro = useUi((s) => s.workspace === 'micro');
  const look = useUi((s) => s.roadLook);
  const lens = useUi((s) => s.lens);
  const colorMode = useUi((s) => s.roadColorMode);
  const setColorMode = useUi((s) => s.setRoadColorMode);
  const basemap = useEditor((s) => s.basemap);
  const lookLabel = LOOKS.find(([v]) => v === look)?.[1];
  const basemapLabel = basemap === 'satellite' ? 'спутник' : basemap === 'none' ? 'без подложки' : null;
  const bands = colorMode === 'class' ? null : THEMATIC[colorMode].bands;
  return (
    <div className={`float-view${micro ? ' is-micro' : ''}`}>
      <div className="float float-viewnote">
        <button className="btn btn-sm btn-quiet" onClick={openViewSettings} title="Вид дорог, линза, цвет, подложка и слои">
          <Icon name="layers" /> Вид карты{!micro && <b>{lookLabel}</b>}{basemapLabel && <span className="hint">{basemapLabel}</span>}
        </button>
        {lens !== 'all' && (
          <span className="view-chip">Линза: {LENSES.find(([v]) => v === lens)?.[1]}
            <button className="icon-btn" onClick={() => pickLens('all')} aria-label="Показать всё" title="Показать всё"><Icon name="close" size={11} /></button>
          </span>
        )}
        {!micro && colorMode !== 'class' && (
          <span className="view-chip">Цвет: {COLOR_MODES.find(([v]) => v === colorMode)?.[1].toLowerCase()}
            <button className="icon-btn" onClick={() => setColorMode('class')} aria-label="Красить по классу" title="Красить по классу дороги"><Icon name="close" size={11} /></button>
          </span>
        )}
      </div>
      {!micro && bands && <ul className="float float-legend thematic-legend">{bands.map((b) => <li key={b.label}><i style={{ background: b.color }} />{b.label}</li>)}</ul>}
    </div>
  );
}
