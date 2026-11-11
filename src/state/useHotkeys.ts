import { TOOLS_IN } from '../map/editScope';
import { useEffect } from 'react';
import { ROAD_TEMPLATES } from '../osm/tags';
import { useEditor, type Mode } from './store';
import { useUi } from './ui';
import { removePickedLink } from './laneActions';
import { useBuildingTool } from '../map/buildingTool';
import { useParkingTool } from '../map/parkingTool';
import { PARKING_TEMPLATES } from '../osm/parking';
import { removePickedCorner } from '../map/useBuildingEditing';
import { copySelected, duplicateSelected, pasteBuilding, selectedBuildingId } from './buildingActions';
import { BUILDING_TEMPLATES } from '../osm/buildingShape';
import { deleteSelection, openFile, saveOsm, finishDrawing, flipSelected, nudgeSelected, reverseSelected, splitAtSelected, toggleSignalSelected } from './actions';
import { usePanels } from './panels';

const MODE_KEYS: Readonly<Record<string, Mode>> = { h: 'view', v: 'select', d: 'draw', n: 'insert', t: 'signal', b: 'building', k: 'parking' };

export const HOTKEYS: ReadonlyArray<[string, string]> = [
  ['V / D / N / T / B / K', 'Выбор / Рисовать дорогу / Узел на дороге / Объект ОДД / Здание / Парковка'],
  ['K, затем 1–3, R, Shift+R', 'Парковка: размер, поворот на 90° и на 15°'],
  ['Enter, двойной клик', 'Завершить дорогу'],
  ['Esc', 'Отменить рисование / снять выделение'],
  ['1–9', 'Шаблон новой дороги'],
  ['R', 'Развернуть порядок узлов (смысл сохраняется)'],
  ['B, затем 1–3, R, Shift+R', 'Здание: шаблон, поворот на 90° и на 15°'],
  ['⌘/Ctrl+D, ⌘/Ctrl+C, ⌘/Ctrl+V', 'Копия здания рядом / скопировать / вставить под курсором'],
  ['Alt при перетаскивании угла', 'Без прилипания к прямому углу'],
  ['F', 'Поменять направление одностороннего движения'],
  ['S', 'Светофор в выбранном узле'],
  ['X', 'Разрезать дороги в выбранном узле'],
  ['P', 'Переключить 2D и 3D'],
  ['Стрелки, Shift+стрелки', 'Сдвинуть выбранный узел или здание на 1 м / 10 м'],
  ['⌘/Ctrl+F', 'Поиск улицы, перекрёстка или знака'],
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
const removeOrDelete = () => {
  if (useUi.getState().laneLink) removePickedLink();
  else if (!removePickedCorner()) deleteSelection();
};

function handleKey(e: KeyboardEvent): void {
  const key = physicalKey(e);
  const mod = e.ctrlKey || e.metaKey;
  // File shortcuts work even while typing in a field.
  if (mod && key === 's') { e.preventDefault(); void saveOsm(e.shiftKey); return; }
  if (mod && key === 'o') { e.preventDefault(); void openFile(); return; }
  if (mod && key === 'f') { e.preventDefault(); focusSearch(); return; }
  if (isTyping(e.target)) return;
  const s = useEditor.getState();
  if ((e.ctrlKey || e.metaKey) && key === 'z') { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); return; }
  if ((e.ctrlKey || e.metaKey) && key === 'y') { e.preventDefault(); s.redo(); return; }
  // Copies of the selected building: next to it, or through the clipboard to the cursor.
  if (mod && key === 'd' && selectedBuildingId()) { e.preventDefault(); duplicateSelected(); return; }
  if (mod && key === 'c' && copySelected()) { e.preventDefault(); return; }
  if (mod && key === 'v' && pasteBuilding()) { e.preventDefault(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  // The building tool has its own digits and R: template and turn of the ghost.
  if (s.mode === 'building') {
    const tool = useBuildingTool.getState();
    const n = Number.parseInt(key, 10);
    if (n >= 1 && n <= BUILDING_TEMPLATES.length) { tool.setTemplate(n - 1); return; }
    if (key === 'r') { e.preventDefault(); tool.rotate(e.shiftKey ? 15 : 90); return; }
    if (key === 'escape') { s.setMode('select'); return; }
  }
  // So has the car park tool: size and turn of the lot.
  if (s.mode === 'parking') {
    const tool = useParkingTool.getState();
    const n = Number.parseInt(key, 10);
    if (n >= 1 && n <= PARKING_TEMPLATES.length) { tool.setTemplate(n - 1); return; }
    if (key === 'r') { e.preventDefault(); tool.rotate(e.shiftKey ? 15 : 90); return; }
    if (key === 'escape') { s.setMode('select'); return; }
  }

  if (MODE_KEYS[key]) { if (TOOLS_IN[useUi.getState().lens].has(MODE_KEYS[key])) s.setMode(MODE_KEYS[key]); return; }
  const template = Number.parseInt(key, 10);
  if (template >= 1 && template <= Math.min(9, ROAD_TEMPLATES.length)) { s.setTemplate(template - 1); return; }
  const actions: Record<string, () => void> = {
    enter: finishDrawing,
    escape: () => {
      if (useUi.getState().laneLink) useUi.getState().setLaneLink(null);
      else if (useUi.getState().curveControl) useUi.getState().setCurveControl(null);
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

/** Opens the navigator on its objects and puts the cursor in the search. */
function focusSearch(): void {
  usePanels.getState().set({ navOpen: true });
  useUi.getState().setNavTab('objects');
  requestAnimationFrame(() => {
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Поиск по объектам"]');
    input?.focus();
    input?.select();
  });
}

const ARROWS: Readonly<Record<string, [number, number]>> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };

/** Arrows nudge the selected node or building; caught before the map, which pans on arrows. */
function handleArrow(e: KeyboardEvent): void {
  const d = ARROWS[e.key];
  if (!d || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
  const step = e.shiftKey ? 10 : 1;
  if (nudgeSelected(d[0] * step, d[1] * step)) { e.preventDefault(); e.stopPropagation(); }
}

export function useHotkeys(): void {
  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    window.addEventListener('keydown', handleArrow, true);
    return () => { window.removeEventListener('keydown', handleKey); window.removeEventListener('keydown', handleArrow, true); };
  }, []);
}
