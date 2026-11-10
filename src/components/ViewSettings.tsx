import { useEditor, type Basemap } from '../state/store';
import { useUi, type LayerId } from '../state/ui';
import { usePanels } from '../state/panels';
import { useMacro } from '../macro/store';
import { useTransit } from '../transit/store';
import { LENSES, type Lens } from '../map/lens';
import { TOOLS_IN } from '../map/editScope';

/**
 * Everything about how the map looks, in one place (navigator tab «Вид карты»): road look, lens,
 * road colour, basemap and layers. The map itself keeps only a note of what is switched away
 * from the usual look, with a way back.
 */

export const LAYER_LABELS: Readonly<Record<LayerId, string>> = {
  sidewalks: 'Тротуары', roads: 'Дороги', junctions: 'Перекрёстки', signals: 'Светофоры', crossings: 'Переходы',
  bridges: 'Мосты', tunnels: 'Тоннели', buildings: 'Здания', tram: 'Ж/д и трамвай', signs: 'Знаки', transit: 'Маршруты ОТ', changes: 'Изменения',
};

const LAYER_GROUPS: ReadonlyArray<readonly [string, readonly LayerId[]]> = [
  ['Улично-дорожная сеть', ['roads', 'sidewalks', 'junctions', 'bridges', 'tunnels']],
  ['ТСОДД', ['signals', 'crossings', 'signs']],
  ['Транспорт', ['tram', 'transit']],
  ['Окружение и анализ', ['buildings', 'changes']],
];

export const LENS_HINT: Record<Lens, string> = {
  all: 'Всё на карте, всё можно править',
  car: 'Дороги, полосы и перекрёстки. Знаки, светофоры, рельсы и тротуары не выделяются и не правятся',
  signs: 'Светофоры, знаки и переходы. Дороги видны фоном и не выбираются',
  walk: 'Тротуары, пешеходные улицы, переходы и зебры',
  transit: 'Остановки, маршруты и трамвайные пути',
  rail: 'Железная дорога, станции и платформы',
  metro: 'Линии и станции метро',
  load: 'Загрузка дорог V/C после распределения потоков, только смотреть',
};

const BASEMAPS: ReadonlyArray<readonly [Basemap, string]> = [['osm', 'Схема OSM'], ['satellite', 'Спутник'], ['none', 'Нет']];

/** View mode pick; a tool the mode has no use for gives way to selecting, the load mode works out the flows first. */
export function pickLens(v: Lens): void {
  const was = useUi.getState().lens;
  useUi.getState().setLens(v);
  // Leaving public transport drops the route picked there, so it does not stay on the map.
  if (was === 'transit' && v !== 'transit') useTransit.getState().select(null);
  const editor = useEditor.getState();
  if (!TOOLS_IN[v].has(editor.mode)) editor.setMode(TOOLS_IN[v].has('select') ? 'select' : 'view');
  const macro = useMacro.getState();
  if (v === 'load' && !macro.result && !macro.busy) void macro.run();
}

/** Opens the navigator on its view tab. */
export function openViewSettings(): void {
  usePanels.getState().set({ navOpen: true });
  useUi.getState().setNavTab('view');
}

function Seg<T extends string>({ items, value, onPick, label }: { items: ReadonlyArray<readonly [T, string, string?]>; value: T; onPick: (v: T) => void; label: string }) {
  return (
    <div className="view-seg" role="radiogroup" aria-label={label}>
      {items.map(([v, text, hint]) => (
        <button key={v} role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onPick(v)} title={hint}>{text}</button>
      ))}
    </div>
  );
}

export function LensBlock() {
  const lens = useUi((s) => s.lens);
  return (
    <>
      <h3 className="tpl-group-title">Режим вида</h3>
      <div className="lens-grid">
        {LENSES.map(([v, label]) => <button key={v} className={lens === v ? 'on' : ''} aria-pressed={lens === v} onClick={() => pickLens(v)} title={LENS_HINT[v]}>{label}</button>)}
      </div>
      <p className="lens-hint">{LENS_HINT[lens]}</p>
    </>
  );
}

export function BasemapBlock() {
  const basemap = useEditor((s) => s.basemap);
  const setBasemap = useEditor((s) => s.setBasemap);
  const opacity = useUi((s) => s.basemapOpacity);
  const setOpacity = useUi((s) => s.setBasemapOpacity);
  return (
    <>
      <h3 className="tpl-group-title">Подложка</h3>
      <Seg items={BASEMAPS} value={basemap} onPick={setBasemap} label="Подложка" />
      <label className="blend view-blend" title="Насколько видна подложка под графом">
        <span>граф</span>
        <input type="range" min={0} max={1} step={0.05} value={opacity} disabled={basemap === 'none'} onChange={(e) => setOpacity(Number(e.target.value))} aria-label="Прозрачность подложки" />
        <span>карта</span>
      </label>
    </>
  );
}

function LayersBlock() {
  const layers = useUi((s) => s.layers);
  const toggle = useUi((s) => s.toggleLayer);
  const setAll = (ids: readonly LayerId[], on: boolean) => ids.forEach((id) => { if (useUi.getState().layers[id] !== on) toggle(id); });
  return (
    <>
      {LAYER_GROUPS.map(([title, ids]) => {
        const allOn = ids.every((id) => layers[id]);
        return (
          <div key={title} className="layer-group">
            <div className="layer-group-head">
              <h3 className="tpl-group-title">{title}</h3>
              <button className="link-btn" onClick={() => setAll(ids, !allOn)}>{allOn ? 'скрыть все' : 'показать все'}</button>
            </div>
            <ul className="layer-list">
              {ids.map((id) => (
                <li key={id}>
                  <label className={layers[id] ? 'on' : ''}>
                    <i className={`layer-swatch l-${id}`} aria-hidden="true" />
                    <span>{LAYER_LABELS[id]}</span>
                    <input type="checkbox" className="switch" checked={layers[id]} onChange={() => toggle(id)} />
                  </label>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </>
  );
}

export function ViewSettings() {
  return (
    <div className="nav-layers">
      <LensBlock />
      <BasemapBlock />
      <LayersBlock />
    </div>
  );
}
