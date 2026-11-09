import { ROAD_TEMPLATES } from '../osm/tags';
import { useEditor, type Basemap, type Mode } from '../state/store';
import { BROWSER_FILE_INPUT, finishDrawing, loadExample, loadXml, openFile, saveOsm } from '../state/actions';
import { isDesktop } from '../platform';
import { CheckButton } from './CheckPanel';

const MODES: ReadonlyArray<[Mode, string, string]> = [
  ['select', '↖ Выбор', 'V'], ['draw', '✎ Дорога', 'D'], ['insert', '• Узел', 'N'], ['signal', '🚦 Светофор', 'T'],
];
const BASEMAPS: ReadonlyArray<[Basemap, string]> = [['osm', 'Схема'], ['satellite', 'Спутник'], ['none', 'Без подложки']];

export function Toolbar() {
  const s = useEditor();

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    loadXml(await file.text(), file.name);
  };

  return (
    <header className="toolbar">
      <strong className="brand">Редактор УДС</strong>
      <div className="group">
        <button onClick={() => void openFile()} title="⌘O">Открыть .osm</button>
        {!isDesktop && <input id={BROWSER_FILE_INPUT} type="file" accept=".osm,.xml" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />}
        <button onClick={() => void loadExample()}>Пример</button>
      </div>
      <div className="group">
        <button onClick={s.undo} disabled={!s.past.length} title="Ctrl+Z">↶</button>
        <button onClick={s.redo} disabled={!s.future.length} title="Ctrl+Shift+Z">↷</button>
      </div>
      <div className="group modes">
        {MODES.map(([mode, label, key]) => (
          <button key={mode} className={s.mode === mode ? 'active' : ''} onClick={() => s.setMode(mode)} title={key}>{label}</button>
        ))}
      </div>
      {s.mode === 'draw' && (
        <div className="group">
          <select value={s.templateIndex} onChange={(e) => s.setTemplate(Number(e.target.value))} title="Шаблон дороги (1–6)">
            {ROAD_TEMPLATES.map((t, i) => <option key={t.label} value={i}>{i + 1}. {t.label}</option>)}
          </select>
          <button onClick={finishDrawing} disabled={s.drawing.length < 2}>Готово (Enter)</button>
        </div>
      )}
      <div className="group">
        <select value={s.basemap} onChange={(e) => s.setBasemap(e.target.value as Basemap)} title="Подложка">
          {BASEMAPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div className="group save">
        <CheckButton />
        <input value={s.saveName} onChange={(e) => s.setSaveName(e.target.value)} title="Имя файла = имя команды" />
        <button className="primary" onClick={() => void saveOsm()} disabled={!Object.keys(s.doc.nodes).length} title="⌘S, ⌘⇧S сохранить как">Сохранить .osm</button>
      </div>
    </header>
  );
}
