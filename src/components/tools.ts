import type { Mode } from '../state/store';
import type { IconName } from './icons';

export const TOOLS: ReadonlyArray<{ mode: Mode; label: string; key: string; icon: IconName; hint: string }> = [
  { mode: 'select', label: 'Выбор', key: 'V', icon: 'select', hint: 'Клик выбирает дорогу или узел. Узел можно тащить, а брошенный на другой узел он станет перекрёстком.' },
  { mode: 'draw', label: 'Дорога', key: 'D', icon: 'road', hint: 'Кликайте точки новой дороги. Клик по существующей дороге ставит перекрёсток. Enter или двойной клик завершают, Esc отменяет.' },
  { mode: 'insert', label: 'Узел', key: 'N', icon: 'node', hint: 'Клик по дороге добавляет узел: для изгиба или будущего перекрёстка.' },
  { mode: 'signal', label: 'ОДД', key: 'T', icon: 'signal', hint: 'Выберите объект ниже. Клик по узлу ставит или снимает его, клик по дороге ставит в новой точке.' },
];
