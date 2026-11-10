import { useMemo } from 'react';
import { setNodeTags, setWayTags } from '../osm/edit';
import { canHavePsvLane, hasPsvLane, setPsvLane, travels, type Travel } from '../osm/busLanes';
import { withTag } from '../osm/tags';
import type { OsmNode, OsmWay } from '../osm/types';
import { transitRoutes } from '../transit/routes';
import { useEditor } from '../state/store';
import { useSettledDoc } from '../state/settled';
import { SelectField, TextField } from './fields';

/**
 * Public transport on the map: the lane for route vehicles and taxis in the road inspector, and
 * the stop's details in the node inspector.
 */

const TRAVEL_LABEL: Readonly<Record<Travel, string>> = { forward: 'туда →', backward: 'обратно ←' };

/** Road inspector: give the rightmost lane of a direction to buses and taxis, or take it back. */
export function BusLaneFields({ way }: { way: OsmWay }) {
  const apply = useEditor((s) => s.apply);
  const t = way.tags;
  const dirs = travels(t);
  const one = dirs.length === 1;
  return (
    <div className="bus-lanes">
      {dirs.map((d) => {
        const can = canHavePsvLane(t, d);
        return (
          <label key={d} className="check" title={can ? 'Правая полоса только для маршрутных ТС и такси (знаки 5.11.1, 5.14): psv:lanes. SUMO пускает по ней только автобусы и такси' : 'Нужно хотя бы две полосы в этом направлении: одна остаётся остальным машинам'}>
            <input type="checkbox" checked={hasPsvLane(t, d)} disabled={!can && !hasPsvLane(t, d)}
              onChange={(e) => apply((doc) => setWayTags(doc, way.id, setPsvLane(t, d, e.target.checked)))} />
            Полоса для ОТ и такси{one ? '' : ` ${TRAVEL_LABEL[d]}`}
          </label>
        );
      })}
    </div>
  );
}

const BAY_OPTIONS = [['', 'Нет'], ['right', 'Справа'], ['left', 'Слева'], ['both', 'С обеих сторон']] as const;
const YES_NO = [['', 'Не указано'], ['yes', 'Есть'], ['no', 'Нет']] as const;

/** Node inspector: a stop of buses, trolleybuses and minibuses, and the routes that call at it. */
export function StopSection({ node }: { node: OsmNode }) {
  const doc = useSettledDoc();
  const apply = useEditor((s) => s.apply);
  const t = node.tags;
  const set = (key: string) => (value: string) => apply((d) => setNodeTags(d, node.id, withTag(t, key, value || null)));
  const routes = useMemo(() => transitRoutes(doc).filter((r) => r.stops.some((s) => s.id === node.id)), [doc, node.id]);
  return (
    <div className="stop-fields">
      <TextField label="Название остановки" value={t.name ?? ''} onCommit={set('name')} />
      <div className="row">
        <SelectField label="Карман" value={t.bus_bay ?? ''} options={BAY_OPTIONS} onChange={set('bus_bay')} />
        <SelectField label="Навес" value={t.shelter ?? ''} options={YES_NO} onChange={set('shelter')} />
      </div>
      <p className="hint">
        {routes.length ? `Маршруты: ${routes.map((r) => r.ref || r.name).join(', ')}.` : 'Ни один маршрут ОТ из файла здесь не останавливается.'}
        {' '}Карман — заездной: автобус встаёт с проезжей части и не держит поток.
      </p>
    </div>
  );
}
