import { useEffect } from 'react';
import { ROAD_TEMPLATES } from '../osm/tags';
import { useEditor, type Mode } from './store';
import { deleteSelection, finishDrawing, flipSelected, reverseSelected, splitAtSelected, toggleSignalSelected } from './actions';

const MODE_KEYS: Readonly<Record<string, Mode>> = { v: 'select', d: 'draw', n: 'insert', t: 'signal' };

export const HOTKEYS: ReadonlyArray<[string, string]> = [
  ['V / D / N / T', 'Выбор / Рисовать дорогу / Узел на дороге / Светофор'],
  ['Enter, двойной клик', 'Завершить дорогу'],
  ['Esc', 'Отменить рисование / снять выделение'],
  [`1–${ROAD_TEMPLATES.length}`, 'Шаблон новой дороги'],
  ['R', 'Развернуть порядок узлов (смысл сохраняется)'],
  ['F', 'Поменять направление одностороннего движения'],
  ['S', 'Светофор в выбранном узле'],
  ['X', 'Разрезать дороги в выбранном узле'],
  ['Delete / Backspace', 'Удалить выбранное'],
  ['Ctrl+Z / Ctrl+Shift+Z', 'Отменить / Повторить'],
];

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);

function handleKey(e: KeyboardEvent): void {
  if (isTyping(e.target)) return;
  const s = useEditor.getState();
  const key = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && key === 'z') { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); return; }
  if ((e.ctrlKey || e.metaKey) && key === 'y') { e.preventDefault(); s.redo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (MODE_KEYS[key]) { s.setMode(MODE_KEYS[key]); return; }
  const template = Number.parseInt(key, 10);
  if (template >= 1 && template <= ROAD_TEMPLATES.length) { s.setTemplate(template - 1); return; }
  const actions: Record<string, () => void> = {
    enter: finishDrawing,
    escape: () => (s.drawing.length ? s.setDrawing([]) : s.select(null)),
    delete: deleteSelection,
    backspace: deleteSelection,
    r: reverseSelected,
    f: flipSelected,
    s: toggleSignalSelected,
    x: splitAtSelected,
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
