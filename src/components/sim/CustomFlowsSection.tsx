import { MAX_VPH, useCustomFlows } from '../../sim/customFlows';
import { useSim } from '../../sim/store';

/**
 * Micro panel: the user's own flows. «Добавить поток», then two clicks on the map (where they
 * come from, where they go); the volume of each is set here in vehicles an hour.
 */
export function CustomFlowsSection() {
  const { flows, pick, startPick, cancelPick, update, remove, clear } = useCustomFlows();
  const demand = useSim((s) => s.demand);
  const setDemand = useSim((s) => s.setDemand);
  const total = flows.reduce((s, f) => s + f.vph, 0);
  return (
    <div className="section-body custom-flows">
      <span className="micro">Свои потоки</span>
      <p className="hint">Поездки, которые вы знаете по городу: откуда, куда и сколько машин в час. SUMO поведёт каждый поток по самому быстрому пути между его концами.</p>
      {flows.length > 0 && (
        <ul className="flow-list">
          {flows.map((f) => (
            <li key={f.id}>
              <input className="flow-label" value={f.label} onChange={(e) => update(f.id, { label: e.target.value })} aria-label="Название потока" />
              <input type="number" min={1} max={MAX_VPH} step={50} value={f.vph} onChange={(e) => update(f.id, { vph: Number(e.target.value) || 1 })} aria-label="Машин в час" />
              <span className="hint">авт/ч</span>
              <button className="icon-btn" onClick={() => remove(f.id)} aria-label="Удалить поток" title="Удалить">✕</button>
            </li>
          ))}
        </ul>
      )}
      <div className="buttons">
        {pick ? (
          <>
            <span className="flow-pick">{pick === 'from' ? 'Клик на карте: откуда едут' : 'Клик на карте: куда едут'}</span>
            <button className="btn btn-sm" onClick={cancelPick}>Отмена</button>
          </>
        ) : (
          <button className="btn btn-sm btn-ink" onClick={startPick}>Добавить поток</button>
        )}
        {flows.length > 0 && !pick && <button className="btn btn-sm btn-quiet" onClick={clear}>Удалить все</button>}
      </div>
      {flows.length > 0 && <p className="hint">Всего {total} авт/ч.{demand !== 'custom' && <> <button className="link" onClick={() => setDemand('custom')}>Считать модель по ним</button></>}</p>}
    </div>
  );
}
