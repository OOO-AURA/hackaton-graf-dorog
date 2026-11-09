import { useEffect } from 'react';
import { ROAD_TEMPLATES } from '../osm/tags';
import { useEditor, type Mode } from './store';
import { useUi } from './ui';
import { removePickedLink } from './laneActions';
import { deleteSelection, openFile, saveOsm, finishDrawing, flipSelected, reverseSelected, splitAtSelected, toggleSignalSelected } from './actions';

const MODE_KEYS: Readonly<Record<string, Mode>> = { v: 'select', d: 'draw', n: 'insert', t: 'signal' };

export const HOTKEYS: ReadonlyArray<[string, string]> = [
  ['V / D / N / T', 'Выбор / Рисовать дорогу / Узел на дороге / Объект ОДД'],
  ['Enter, двойной клик', 'Завершить дорогу'],
  ['Esc', 'Отменить рисование / снять выделение'],
  [`1–${ROAD_TEMPLATES.length}`, 'Шаблон новой дороги'],
  ['R', 'Развернуть порядок узлов (смысл сохраняется)'],
  ['F', 'Поменять направление одностороннего движения'],
  ['S', 'Светофор в выбранном узле'],
  ['X', 'Разрезать дороги в выбранном узле'],
  ['P', 'Переключить 2D и 3D'],
  ['Delete / Backspace', 'Удалить выбранное'],
  ['⌘/Ctrl+Z, ⌘/Ctrl+Shift+Z', 'Отменить / Повторить'],
  ['⌘/Ctrl+O', 'Открыть файл'],
  ['⌘/Ctrl+S, ⌘/Ctrl+Shift+S', 'Сохранить / Сохранить как'],
];

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);

/** Letter and digit keys by position, so shortcuts work in the Russian layout too. */
function physicalKey(e: KeyboardEvent): string {
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(e.code)) return e.code.slice(5);
  return e.key.toLowerCase();
}

/** Delete forbids the picked lane link, if there is one, and otherwise deletes the selection. */
const removeOrDelete = () => (useUi.getState().laneLink ? removePickedLink() : deleteSelection());

function handleKey(e: KeyboardEvent): void {
  const key = physicalKey(e);
  const mod = e.ctrlKey || e.metaKey;
  // File shortcuts work even while typing in a field.
  if (mod && key === 's') { e.preventDefault(); void saveOsm(e.shiftKey); return; }
  if (mod && key === 'o') { e.preventDefault(); void openFile(); return; }
  if (isTyping(e.target)) return;
  const s = useEditor.getState();
  if ((e.ctrlKey || e.metaKey) && key === 'z') { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); return; }
  if ((e.ctrlKey || e.metaKey) && key === 'y') { e.preventDefault(); s.redo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (MODE_KEYS[key]) { s.setMode(MODE_KEYS[key]); return; }
  const template = Number.parseInt(key, 10);
  if (template >= 1 && template <= ROAD_TEMPLATES.length) { s.setTemplate(template - 1); return; }
  const actions: Record<string, () => void> = {
    enter: finishDrawing,
    escape: () => {
      if (useUi.getState().laneLink) useUi.getState().setLaneLink(null);
      else if (s.drawing.length) s.setDrawing([]);
      else s.select(null);
    },
    delete: removeOrDelete,
    backspace: removeOrDelete,
    r: reverseSelected,
    f: flipSelected,
    s: toggleSignalSelected,
    x: splitAtSelected,
    p: () => useUi.getState().toggle3d(),
  };
  const action = actions[key];
  if (action) { e.preventDefault(); action(); }
}

export function useHotkeys(): void {
  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);
}
