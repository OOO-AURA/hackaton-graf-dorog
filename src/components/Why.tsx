import { useEffect, useRef } from 'react';

/** What a panel is for, in plain words; one short paragraph. */
export const WHY = {
  navigator: 'Инструменты правят граф прямо на карте. Шаблон задаёт профиль новой дороги: класс, полосы, скорость. Список улиц быстро приводит к нужной.',
  inspector: 'Здесь атрибуты выбранной дороги или узла: полосы, класс, скорость, направление, светофор. От них зависит пропускная способность в MATSim и то, как едут машины в SUMO.',
  micro: 'SUMO ведёт каждую машину отдельно: видно очереди у светофоров, задержку по HCM и разницу с базовым прогоном. Так проверяют, помогла ли правка на конкретном перекрёстке.',
  issues: 'MATSim и SUMO молча выкидывают дороги, с которых некуда выехать, и не видят перекрёстков без общего узла. Валидация находит такие места до экспорта, многие исправляются одной кнопкой.',
  check: 'Граф проходит через те же программы, что на сервере организаторов: netconvert и sumo, MATSim, импортёр Webots. Если здесь всё зелёное, файл примут.',
  flows: 'Макромодель показывает, где сеть не справится в час пик. Зоны порождают поездки, гравитационная модель делит их между зонами, равновесное назначение выбирает пути. Правка графа сразу видна по загрузке V/C.',
  transit: 'Маршруты автобусов берутся из OSM-отношений. Их можно пустить в Микро с нужным интервалом и посмотреть, как правка улицы меняет скорость автобусов.',
  scenarios: 'Сценарий хранит версию графа и её показатели. Сохраните базу, сделайте правку отдельным сценарием и сравните пробег, задержку и скорость в одной таблице.',
  journal: 'Каждая правка записывается шагом. Клик по шагу возвращает граф к этому моменту, так легко показать, что именно поменяли.',
} as const;

export type WhyId = keyof typeof WHY;

/** «Зачем» button with a short explanation of the panel it sits in. */
export function Why({ id, align = 'end' }: { id: WhyId; align?: 'start' | 'end' }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: Event) => {
      const el = ref.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, []);
  return (
    <details className={`why why-${align}`} ref={ref}>
      <summary aria-label="Зачем эта панель">Зачем</summary>
      <p className="why-body">{WHY[id]}</p>
    </details>
  );
}
