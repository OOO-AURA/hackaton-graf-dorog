import { isDirty, useEditor } from '../state/store';
import { BROWSER_FILE_INPUT, openFile, saveOsm } from '../state/actions';
import { isDesktop } from '../platform';
import { useUi } from '../state/ui';
import { AreaMenu } from './AreaMenu';
import { openBrowserFile, openExample } from './fileActions';
import { Icon } from './icons';
import { Petals } from './EmptyState';
import { StepBar } from './StepBar';

function SaveStatus() {
  const empty = useEditor((s) => !Object.keys(s.doc.nodes).length);
  const dirty = useEditor(isDirty);
  if (empty) return null;
  return (
    <span className={`save-status${dirty ? ' dirty' : ''}`} role="status">
      <i aria-hidden="true" />{dirty ? 'Не сохранено' : 'Сохранено'}
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

/**
 * Header, left to right: the file (open, example, any area of OSM, undo), the steps of the work,
 * then help, theme and save. The server check and the exports live in the step «Сдача».
 */
export function Header() {
  const fileName = useEditor((s) => s.fileName);
  const empty = useEditor((s) => !Object.keys(s.doc.nodes).length);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const setHelpOpen = useUi((s) => s.setHelpOpen);

  return (
    <header className="header">
      <div className="header-left">
        <div className="brand"><Petals size={22} /><span className="display">Граф дорог</span></div>
        <div className="btn-group">
          <button className="btn btn-quiet" onClick={() => void openFile()} title="Открыть .osm с диска (⌘O)"><Icon name="open" /> Открыть</button>
          {!isDesktop && <input id={BROWSER_FILE_INPUT} type="file" accept=".osm,.xml" hidden onChange={(e) => { void openBrowserFile(e.target.files?.[0]); e.target.value = ''; }} />}
          <button className="btn btn-quiet" onClick={() => void openExample()} title="Фрагмент из задания">Пример</button>
          <AreaMenu align="left" />
        </div>
        <div className="btn-group">
          <button className="icon-btn" onClick={undo} disabled={!canUndo} title="Отменить (⌘Z)" aria-label="Отменить"><Icon name="undo" /></button>
          <button className="icon-btn" onClick={redo} disabled={!canRedo} title="Повторить (⌘⇧Z)" aria-label="Повторить"><Icon name="redo" /></button>
        </div>
      </div>

      {empty ? <span /> : <StepBar />}

      <div className="header-right">
        {!empty && (
          <div className="file">
            <span className="file-name mono" title={fileName}>{fileName}</span>
            <SaveStatus />
          </div>
        )}
        <button className="icon-btn help-btn" onClick={() => setHelpOpen(true)} title="Как работать и горячие клавиши (?)" aria-label="Справка">?</button>
        <ThemeToggle />
        <button className="btn btn-ink" onClick={() => void saveOsm()} disabled={empty} title="⌘S, сохранить как ⌘⇧S. Имя файла и экспорт — в шаге «Сдача»"><Icon name="save" /> Сохранить</button>
      </div>
    </header>
  );
}
