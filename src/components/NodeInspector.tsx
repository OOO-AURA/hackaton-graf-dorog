import { setNodeTags, waysOfNode } from '../osm/edit';
import { withTag } from '../osm/tags';
import type { OsmNode } from '../osm/types';
import { useEditor } from '../state/store';
import { deleteSelection, splitAtSelected, toggleSignalSelected } from '../state/actions';
import { SelectField } from './fields';
import { TagTable } from './TagTable';

const NODE_KIND_OPTIONS = [
  ['', 'Обычный узел'], ['traffic_signals', 'Светофор'], ['crossing', 'Пешеходный переход'],
  ['stop', 'Знак STOP'], ['give_way', 'Уступи дорогу'], ['bus_stop', 'Остановка'],
] as const;

const SIGNAL_DIRECTION_OPTIONS = [['', 'Все направления'], ['forward', 'Только по ходу линии'], ['backward', 'Только против хода']] as const;

export function NodeInspector({ node }: { node: OsmNode }) {
  const apply = useEditor((s) => s.apply);
  const doc = useEditor((s) => s.doc);
  const select = useEditor((s) => s.select);
  const ways = waysOfNode(doc, node.id);
  const setTag = (key: string) => (value: string) => apply((d) => setNodeTags(d, node.id, withTag(node.tags, key, value || null)));
  const isSignal = node.tags.highway === 'traffic_signals';
  const inner = ways.some((w) => w.refs.indexOf(node.id) > 0 && w.refs.indexOf(node.id) < w.refs.length - 1);

  return (
    <div className="inspector">
      <h3>Узел <code>#{node.id}</code></h3>
      <SelectField label="Тип" value={node.tags.highway ?? ''} options={NODE_KIND_OPTIONS} onChange={setTag('highway')} />
      {isSignal && <SelectField label="Светофор действует" value={node.tags['traffic_signals:direction'] ?? ''} options={SIGNAL_DIRECTION_OPTIONS} onChange={setTag('traffic_signals:direction')} />}
      <div className="buttons">
        <button onClick={toggleSignalSelected} title="S">{isSignal ? 'Убрать светофор' : '🚦 Светофор'}</button>
        <button onClick={splitAtSelected} disabled={!inner} title="X">✂ Разрезать здесь</button>
        <button className="danger" onClick={deleteSelection} title="Delete">Удалить</button>
      </div>
      <p className="hint">{node.lat.toFixed(6)}, {node.lon.toFixed(6)}</p>
      {ways.length > 0 && (
        <div className="way-list">
          <span>Дороги через узел:</span>
          {ways.map((w) => (
            <button key={w.id} className="link" onClick={() => select({ type: 'way', id: w.id })}>
              {w.tags.name || w.tags.highway || 'линия'} #{w.id}
            </button>
          ))}
        </div>
      )}
      <TagTable tags={node.tags} onChange={(tags) => apply((d) => setNodeTags(d, node.id, tags))} />
    </div>
  );
}
