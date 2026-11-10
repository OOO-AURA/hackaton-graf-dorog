import type { Mode } from '../state/store';
import type { IconName } from './icons';

export const TOOLS: ReadonlyArray<{ mode: Mode; label: string; key: string; icon: IconName; hint: string }> = [
  { mode: 'view', label: 'Просмотр', key: 'H', icon: 'eye', hint: 'Только смотреть: клик показывает объект в инспекторе, но ничего нельзя сдвинуть, удалить или поменять.' },
  { mode: 'select', label: 'Выбор', key: 'V', icon: 'select', hint: 'Клик выбирает дорогу, узел или здание. Узел можно тащить, а брошенный на другой узел он станет перекрёстком.' },
  { mode: 'draw', label: 'Дорога', key: 'D', icon: 'road', hint: 'Кликайте точки новой дороги. Клик по существующей дороге ставит перекрёсток. Enter или двойной клик завершают, Esc отменяет.' },
  { mode: 'insert', label: 'Узел', key: 'N', icon: 'node', hint: 'Клик по дороге добавляет узел: для изгиба или будущего перекрёстка.' },
  { mode: 'building', label: 'Здание', key: 'B', icon: 'building', hint: 'Клик ставит здание выбранного шаблона, оно само встаёт вдоль ближней дороги. R поворачивает на 90°, Shift+R на 15°, с Alt без выравнивания. Esc — выход.' },
  { mode: 'signal', label: 'ОДД', key: 'T', icon: 'signal', hint: 'Выберите знак или объект в капсуле внизу. Знак прилипает к ближней дороге и встаёт у её края, со стороны курсора; светофор встаёт на перекрёсток. Клик ставит.' },
];
