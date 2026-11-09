import { isDirty, useEditor } from '../state/store';
import { BROWSER_FILE_INPUT, openFile, saveOsm } from '../state/actions';
import { isDesktop } from '../platform';
import { useUi, type Workspace } from '../state/ui';
import { CheckButton } from './CheckPanel';
import { ExportMenu } from './ExportMenu';
import { openBrowserFile, openExample } from './fileActions';
import { Icon } from './icons';
import { Petals } from './EmptyState';

const WORKSPACES: ReadonlyArray<[Workspace, string, string]> = [
  ['macro', 'Макро', 'Граф УДС для MATSim и SUMO: правка и проверка'],
  ['micro', 'Микро', 'Микросимуляция SUMO: машины по полосам, LOS, графики'],
];

function SaveStatus() {
  const empty = useEditor((s) => !Object.keys(s.doc.nodes).length);
  const dirty = useEditor(isDirty);
  if (empty) return null;
  return (
    <span className={`save-status${dirty ? ' dirty' : ''}`} role="status">
      <i aria-hidden="true" />{dirty ? 'Есть изменения' : 'Сохранено'}
    </span>
  );
}

function ThemeToggle() {
  const theme = useUi((s) => s.theme);
  const setChoice = useUi((s) => s.setThemeChoice);
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button className="icon-btn" onClick={() => setChoice(next)} title={next === 'dark' ? 'Тёмная тема' : 'Светлая тема'} aria-label="Сменить тему">
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  );
}

export function Header() {
  const fileName = useEditor((s) => s.fileName);
  const empty = useEditor((s) => !Object.keys(s.doc.nodes).length);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const saveName = useEditor((s) => s.saveName);
  const setSaveName = useEditor((s) => s.setSaveName);
  const workspace = useUi((s) => s.workspace);
  const setWorkspace = useUi((s) => s.setWorkspace);

  return (
    <header className="header">
      <div className="header-left">
        <div className="brand"><Petals size={22} /><span className="display">Граф дорог</span></div>
        <div className="file">
          <span className="file-name mono" title={fileName}>{empty ? 'нет файла' : fileName}</span>
          <SaveStatus />
        </div>
        <div className="btn-group">
          <button className="icon-btn" onClick={() => void openFile()} title="Открыть .osm (⌘O)" aria-label="Открыть"><Icon name="open" /></button>
          {!isDesktop && <input id={BROWSER_FILE_INPUT} type="file" accept=".osm,.xml" hidden onChange={(e) => { void openBrowserFile(e.target.files?.[0]); e.target.value = ''; }} />}
          <button className="btn btn-quiet" onClick={() => void openExample()}>Пример</button>
        </div>
        <div className="btn-group">
          <button className="icon-btn" onClick={undo} disabled={!canUndo} title="Отменить (⌘Z)" aria-label="Отменить"><Icon name="undo" /></button>
          <button className="icon-btn" onClick={redo} disabled={!canRedo} title="Повторить (⌘⇧Z)" aria-label="Повторить"><Icon name="redo" /></button>
        </div>
      </div>

      <nav className="workspaces" aria-label="Уровень модели">
        {WORKSPACES.map(([id, label, hint]) => (
          <button key={id} data-tour={`${id}-toggle`} className={workspace === id ? 'on' : ''} aria-current={workspace === id ? 'page' : undefined} onClick={() => setWorkspace(id)} title={hint}>{label}</button>
        ))}
      </nav>

      <div className="header-right">
        <ThemeToggle />
        <CheckButton />
        <ExportMenu disabled={empty} />
        <div className="save-box">
          <input className="mono" value={saveName} onChange={(e) => setSaveName(e.target.value)} title="Имя файла. Сервер проверки ждёт имя команды" aria-label="Имя файла" spellCheck={false} />
          <button className="btn btn-ink" onClick={() => void saveOsm()} disabled={empty} title="⌘S, сохранить как ⌘⇧S"><Icon name="save" /> Сохранить</button>
        </div>
      </div>
    </header>
  );
}
