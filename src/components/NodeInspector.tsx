import { setNodeTags, waysOfNode } from '../osm/edit';
import { withTag } from '../osm/tags';
import type { OsmNode } from '../osm/types';
import { useEditor } from '../state/store';
import { deleteSelection, splitAtSelected, toggleSignalSelected } from '../state/actions';
import { SelectField, TextField } from './fields';
import { TagTable } from './TagTable';
import { Section } from './Section';
import { NODE_FEATURES, nodeSymbol } from '../map/features';
import { Icon } from './icons';

const NODE_KIND_OPTIONS = [
  ['', 'Обычный узел'], ['traffic_signals', 'Светофор'], ['crossing', 'Пешеходный переход'],
  ['stop', 'Знак STOP'], ['give_way', 'Уступи дорогу'], ['bus_stop', 'Остановка'],
] as const;

const CROSSING_OPTIONS = [['uncontrolled', 'Нерегулируемый (зебра)'], ['traffic_signals', 'Со светофором'], ['unmarked', 'Без разметки']] as const;
const CALMING_OPTIONS = [['', 'Нет'], ['bump', 'Лежачий полицейский'], ['hump', 'Широкая неровность'], ['table', 'Приподнятый переход']] as const;

const SIGNAL_DIRECTION_OPTIONS = [['', 'Все направления'], ['forward', 'Только по ходу линии'], ['backward', 'Только против хода']] as const;

export function NodeInspector({ node }: { node: OsmNode }) {
  const apply = useEditor((s) => s.apply);
  const doc = useEditor((s) => s.doc);
  const select = useEditor((s) => s.select);
  const ways = waysOfNode(doc, node.id);
  const setTag = (key: string) => (value: string) => apply((d) => setNodeTags(d, node.id, withTag(node.tags, key, value || null)));
  const isSignal = node.tags.highway === 'traffic_signals';
  const inner = ways.some((w) => w.refs.indexOf(node.id) > 0 && w.refs.indexOf(node.id) < w.refs.length - 1);

  const kind = NODE_KIND_OPTIONS.find(([v]) => v === (node.tags.highway ?? ''))?.[1] ?? node.tags.highway;
  return (
    <div className="inspector">
      <header className="insp-head">
        <span className="micro">Узел</span>
        <h2 className="insp-title">{NODE_FEATURES.find((f) => f.id === nodeSymbol(node.tags))?.label ?? (ways.length > 1 ? 'Перекрёсток' : kind)}</h2>
        <span className="mono insp-id">node {node.id} · {node.lat.toFixed(6)}, {node.lon.toFixed(6)}</span>
      </header>
      <Section title="Организация движения">
        <SelectField label="Тип" value={node.tags.highway ?? ''} options={NODE_KIND_OPTIONS} onChange={setTag('highway')} />
        {isSignal && <SelectField label="Светофор действует" value={node.tags['traffic_signals:direction'] ?? ''} options={SIGNAL_DIRECTION_OPTIONS} onChange={setTag('traffic_signals:direction')} />}
        {node.tags.highway === 'crossing' && <SelectField label="Переход" value={node.tags.crossing ?? ''} options={CROSSING_OPTIONS} onChange={setTag('crossing')} />}
        <div className="row">
          <SelectField label="Неровность" value={node.tags.traffic_calming ?? ''} options={CALMING_OPTIONS} onChange={setTag('traffic_calming')} />
          <TextField label="Знак скорости, км/ч" type="number" value={node.tags.traffic_sign?.startsWith('RU:3.24') ? node.tags.maxspeed ?? '' : ''} placeholder="нет"
            onCommit={(v) => apply((d) => setNodeTags(d, node.id, withTag(withTag(node.tags, 'traffic_sign', v ? 'RU:3.24' : null), 'maxspeed', v || null)))} />
        </div>
        <div className="buttons">
          <button className="btn" onClick={toggleSignalSelected} title="S"><Icon name="signal" /> {isSignal ? 'Убрать светофор' : 'Светофор'} <kbd>S</kbd></button>
          <button className="btn" onClick={splitAtSelected} disabled={!inner} title="X"><Icon name="scissors" /> Разрезать здесь <kbd>X</kbd></button>
        </div>
      </Section>
      {ways.length > 0 && (
        <Section title="Дороги через узел" aside={<span className="mono count">{ways.length}</span>}>
          <ul className="link-list">
            {ways.map((w) => (
              <li key={w.id}><button onClick={() => select({ type: 'way', id: w.id })}><span>{w.tags.name || w.tags.highway || 'линия'}</span><span className="mono">{w.id}</span></button></li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="Все теги OSM" open={false} aside={<span className="mono count">{Object.keys(node.tags).length}</span>}>
        <TagTable tags={node.tags} onChange={(tags) => apply((d) => setNodeTags(d, node.id, tags))} />
      </Section>
      <div className="insp-foot">
        <button className="btn btn-danger" onClick={deleteSelection} title="Delete"><Icon name="trash" /> Удалить узел</button>
      </div>
    </div>
  );
}
