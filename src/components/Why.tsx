import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useUi } from '../state/ui';
import { Icon } from './icons';

/** What a panel is for, in plain words; one short paragraph. */
export const WHY = {
  navigator: 'Инструменты правят граф прямо на карте. Шаблон задаёт профиль новой дороги: класс, полосы, скорость. Список улиц быстро приводит к нужной.',
  inspector: 'Здесь атрибуты выбранной дороги, узла, здания или всей улицы. От полос, класса и скорости зависит пропускная способность в MATSim и движение в SUMO, от этажности и крыши зданий — 3D в Webots. Улица целиком правится одним шагом, без скачков пропускной способности посередине.',
  micro: 'SUMO ведёт каждую машину отдельно: видно очереди у светофоров, задержку по HCM и разницу с базовым прогоном. Так проверяют, помогла ли правка на конкретном перекрёстке.',
  issues: 'MATSim и SUMO молча выкидывают дороги, с которых некуда выехать, и не видят перекрёстков без общего узла. Валидация находит такие места до экспорта, многие исправляются одной кнопкой.',
  check: 'Граф проходит через те же программы, что на сервере организаторов: netconvert и sumo, MATSim, импортёр Webots. Если здесь всё зелёное, файл примут.',
  flows: 'Макромодель показывает, где сеть не справится в час пик. Зоны порождают поездки, гравитационная модель делит их между зонами, равновесное назначение выбирает пути. Правка графа сразу видна по загрузке V/C.',
  transit: 'Маршруты автобусов берутся из OSM-отношений. Их можно пустить в Микро с нужным интервалом и посмотреть, как правка улицы меняет скорость автобусов.',
  scenarios: 'Сценарий хранит версию графа и её показатели. Сохраните базу, сделайте правку отдельным сценарием и сравните пробег, задержку и скорость в одной таблице.',
  journal: 'Каждая правка записывается шагом. Клик по шагу возвращает граф к этому моменту, так легко показать, что именно поменяли.',
  errors: 'Журнал ошибок сессии: сбои приложения (загрузка, SUMO, сохранение) и ошибки графа — когда правка их внесла и когда исправила. Клик по ошибке графа показывает место; журнал можно скачать к отчёту о проблеме.',
} as const;

export type WhyId = keyof typeof WHY;

/** A short line on hover, the full section of the reference on click. */
export function Why({ id, align = 'end' }: { id: WhyId; align?: 'start' | 'end' }) {
  const setHelpOpen = useUi((s) => s.setHelpOpen);
  const [tip, setTip] = useState<DOMRect | null>(null);
  const W = 300;
  const left = tip ? Math.max(8, Math.min(window.innerWidth - W - 8, align === 'end' ? tip.right - W : tip.left)) : 0;
  const below = tip ? tip.bottom + 8 + 140 < window.innerHeight : true;
  return (
    <>
      <button
        type="button"
        className={`why why-${align}`}
        aria-label={`Справка: ${WHY[id]}`}
        onClick={() => { setTip(null); setHelpOpen(true, id); }}
        onPointerEnter={(e) => setTip(e.currentTarget.getBoundingClientRect())}
        onPointerLeave={() => setTip(null)}
        onFocus={(e) => setTip(e.currentTarget.getBoundingClientRect())}
        onBlur={() => setTip(null)}
      >
        <Icon name="info" size={15} />
      </button>
      {tip && createPortal(
        <div className="why-tip" role="tooltip" style={{ left, width: W, ...(below ? { top: tip.bottom + 8 } : { bottom: window.innerHeight - tip.top + 8 }) }}>
          {WHY[id]}<span className="why-more">Нажмите, чтобы открыть раздел справочника</span>
        </div>,
        document.body,
      )}
    </>
  );
}
