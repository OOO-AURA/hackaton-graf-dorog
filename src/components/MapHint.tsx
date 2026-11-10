import { currentSelection, useEditor } from '../state/store';
import { useSettledDoc } from '../state/settled';
import { isBuildingWay } from '../osm/building';
import { useUi } from '../state/ui';
import { TOOLS } from './tools';
import { Icon } from './icons';

/** What to do now, for the tool and the selection on screen; one line. */
function useHintText(): string {
  const mode = useEditor((s) => s.mode);
  const points = useEditor((s) => s.drawing.length);
  const selection = useEditor((s) => currentSelection(s));
  const multi = useEditor((s) => s.multi.length);
  const doc = useSettledDoc();
  if (mode === 'draw') {
    return points ? 'Кликайте следующие точки. Enter или двойной клик заканчивают дорогу, Esc отменяет. Shift держит угол с шагом 15°.'
      : 'Кликните, откуда начинается дорога. Клик по другой дороге или узлу сделает перекрёсток. Шаблон дороги справа.';
  }
  if (mode !== 'select') return TOOLS.find((t) => t.mode === mode)?.hint ?? '';
  if (multi > 1) return `Выбрано дорог: ${multi}. Справа меняются их общие атрибуты, Esc снимает выбор.`;
  if (!selection) return 'Кликните дорогу, перекрёсток или здание: справа появятся его свойства. Shift и рамка мышью выбирают несколько дорог.';
  if (selection.type === 'street') return 'Выбрана вся улица: правка справа меняет все её участки сразу.';
  if (selection.type === 'node') return 'Выбран узел. Тащите его мышью; брошенный на другой узел, он сделает перекрёсток. S ставит светофор, X разрезает дороги.';
  const way = doc.ways[selection.id];
  if (way && isBuildingWay(way)) return 'Выбрано здание. Тяните углы и стороны, чтобы поменять форму; размеры и этажность справа.';
  return selection.piece
    ? 'Выбран участок дороги между перекрёстками: правка справа меняет только его. Delete удаляет участок, Esc снимает выбор.'
    : 'Выбрана дорога целиком. Delete удаляет её, Esc снимает выбор.';
}

/** Bottom line of the map: what the current tool and selection let you do. It can be turned off. */
export function MapHint() {
  const on = useUi((s) => s.mapHints);
  const setOn = useUi((s) => s.setMapHints);
  const text = useHintText();
  if (!on || !text) return null;
  return (
    <div className="float float-hint" role="status" aria-live="polite">
      <span>{text}</span>
      <button className="icon-btn" onClick={() => setOn(false)} aria-label="Скрыть подсказки" title="Скрыть подсказки (вернуть — в справке «?»)"><Icon name="close" size={12} /></button>
    </div>
  );
}

