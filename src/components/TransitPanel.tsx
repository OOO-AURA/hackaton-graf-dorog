import { useMemo } from 'react';
import { useEditor } from '../state/store';
import { useUi } from '../state/ui';
import { setRouteInterval, transitRoutes, type TransitRoute } from '../transit/routes';
import { useTransit } from '../transit/store';
import { useSettledDoc } from '../state/settled';

function RouteCard({ route }: { route: TransitRoute }) {
  const apply = useEditor((s) => s.apply);
  const perHour = 60 / route.interval;
  return (
    <div className="route-card">
      <div className="route-head">
        <span className="route-ref" style={{ background: route.color ?? undefined }}>{route.ref || '—'}</span>
        <strong>{route.name}</strong>
      </div>
      <dl className="facts">
        <dt>Вид</dt><dd>{route.mode === 'trolleybus' ? 'троллейбус' : 'автобус'}</dd>
        <dt>Остановок</dt><dd>{route.stops.length}</dd>
        <dt>Рейсов в час</dt><dd>{perHour.toFixed(perHour < 10 ? 1 : 0)}</dd>
      </dl>
      <label className="field">
        <span className="micro">Интервал движения, мин</span>
        <input type="number" min={1} max={120} defaultValue={route.interval} key={`${route.id}-${route.interval}`}
          onBlur={(e) => { const v = Number(e.target.value); if (v > 0 && v !== route.interval) apply((d) => setRouteInterval(d, route.id, v)); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      </label>
      {route.stops.length < 2 && <p className="hint">В relation нет остановок с ролью stop, поэтому в SUMO этот маршрут не попадёт.</p>}
      <p className="hint">Интервал пишется в тег interval маршрута и сохраняется в .osm. В Микро автобусы маршрута выходят с этим интервалом и стоят на каждой остановке 20 с.</p>
    </div>
  );
}

/** Bus and trolleybus routes of the fragment: list, highlight on the map, headway for SUMO. */
export function TransitPanel() {
  const doc = useSettledDoc();
  const routes = useMemo(() => transitRoutes(doc), [doc]);
  const { selected, select, inSim, setInSim } = useTransit();
  const layerOn = useUi((s) => s.layers.transit);
  const toggleLayer = useUi((s) => s.toggleLayer);
  const current = routes.find((r) => r.id === selected) ?? null;
  const pick = (id: string) => {
    select(id === selected ? null : id);
    if (!layerOn) toggleLayer('transit');
  };
  if (!routes.length) return <p className="hint transit-empty">В файле нет маршрутов route=bus или route=trolleybus.</p>;
  const usable = routes.filter((r) => r.stops.length >= 2).length;
  return (
    <div className="transit">
      <div className="transit-list">
        <div className="transit-top">
          <label className="check"><input type="checkbox" checked={inSim} onChange={(e) => setInSim(e.target.checked)} /> Автобусы маршрутов в Микро</label>
          <span className="hint">{routes.length} маршрутов, {usable} с остановками</span>
        </div>
        <ul>
          {routes.map((r) => (
            <li key={r.id}>
              <button className={`route-row${r.id === selected ? ' on' : ''}`} onClick={() => pick(r.id)}>
                <span className="route-ref" style={{ background: r.color ?? undefined }}>{r.ref || '—'}</span>
                <span className="route-name">{r.name}</span>
                <span className="mono">{r.interval} мин</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {current ? <RouteCard route={current} /> : <p className="hint">Выберите маршрут: он подсветится на карте вместе с остановками, здесь появится интервал движения.</p>}
    </div>
  );
}
