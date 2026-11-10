import { setNodeTags, waysOfNode } from '../osm/edit';
import { withTag } from '../osm/tags';
import type { OsmNode } from '../osm/types';
import { useEditor } from '../state/store';
import { deleteSelection, splitAtSelected, toggleSignalSelected } from '../state/actions';
import { SelectField, TextField } from './fields';
import { formatMetres, nodeElevation, withElevation } from '../osm/height';
import { TagTable } from './TagTable';
import { Section } from './Section';
import { NODE_FEATURES, nodeSymbol } from '../map/features';
import { Icon } from './icons';
import { SignalPlanSection } from './SignalPlanSection';
import { TurnsSection } from './TurnsSection';
import { RouteSection } from './RouteSection';
import { isJunction } from '../osm/turns';
import { JunctionInfo, JunctionLanes, JunctionSigns } from './JunctionParts';
import { JunctionCapacitySection } from './CapacityParts';
import { junctions } from '../osm/lanes';
import { useSettledDoc } from '../state/settled';
import { StopSection } from './BusParts';
import { detachWay } from '../osm/pieces';
import { useUi } from '../state/ui';

const NODE_KIND_OPTIONS = [
  ['', 'Обычный узел'], ['traffic_signals', 'Светофор'], ['crossing', 'Пешеходный переход'],
  ['stop', 'Знак STOP'], ['give_way', 'Уступи дорогу'], ['bus_stop', 'Остановка'],
] as const;

const CROSSING_OPTIONS = [['uncontrolled', 'Нерегулируемый (зебра)'], ['traffic_signals', 'Со светофором'], ['unmarked', 'Без разметки']] as const;
const CALMING_OPTIONS = [['', 'Нет'], ['bump', 'Лежачий полицейский'], ['hump', 'Широкая неровность'], ['table', 'Приподнятый переход']] as const;

const SIGNAL_DIRECTION_OPTIONS = [['', 'Все направления'], ['forward', 'Только по ходу линии'], ['backward', 'Только против хода']] as const;

export function NodeInspector({ node }: { node: OsmNode }) {
  const openEditor = useUi((s) => s.setJunctionEditor);
  const apply = useEditor((s) => s.apply);
  const doc = useSettledDoc();
  const select = useEditor((s) => s.select);
  const ways = waysOfNode(doc, node.id);
  const setTag = (key: string) => (value: string) => apply((d) => setNodeTags(d, node.id, withTag(node.tags, key, value || null)));
  const isSignal = node.tags.highway === 'traffic_signals';
  const inner = ways.some((w) => w.refs.indexOf(node.id) > 0 && w.refs.indexOf(node.id) < w.refs.length - 1);

  const junction = junctions(doc).includes(node.id);
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
        {node.tags.highway === 'bus_stop' && <StopSection node={node} />}
        <div className="row">
          <SelectField label="Неровность" value={node.tags.traffic_calming ?? ''} options={CALMING_OPTIONS} onChange={setTag('traffic_calming')} />
        </div>
        <div className="buttons">
          <button className="btn" onClick={toggleSignalSelected} title="S"><Icon name="signal" /> {isSignal ? 'Убрать светофор' : 'Светофор'} <kbd>S</kbd></button>
          <button className="btn" onClick={splitAtSelected} disabled={!inner} title="X"><Icon name="scissors" /> Разрезать здесь <kbd>X</kbd></button>
        </div>
      </Section>
      {junction && (
        <>
          <div className="insp-cta">
            <button className="btn btn-ink" onClick={() => openEditor(node.id)}>Редактор перекрёстка</button>
            <span className="hint">или двойной клик по перекрёстку на карте</span>
          </div>
          <Section title="Полосы"><JunctionLanes nodeId={node.id} /></Section>
          <Section title="Знаки приоритета"><JunctionSigns nodeId={node.id} /></Section>
        </>
      )}
      {isSignal && <SignalPlanSection node={node} ways={ways} />}
      {isJunction(doc, node.id) && <TurnsSection nodeId={node.id} />}
      {junction && <Section title="Пропускная способность" open={false}><JunctionCapacitySection nodeId={node.id} /></Section>}
      {junction && <Section title="Сведения" open={false}><JunctionInfo nodeId={node.id} /></Section>}
      <RouteSection nodeId={node.id} />
      <Section title="Высота" open={false}>
        <TextField
          label="Отметка над уровнем моря, м" type="number" placeholder="—"
          value={nodeElevation(node.tags) === null ? '' : formatMetres(nodeElevation(node.tags)!)}
          onCommit={(v) => apply((d) => setNodeTags(d, node.id, withElevation(node.tags, v ? Number.parseFloat(v.replace(',', '.')) : null)))}
        />
        <p className="hint">Пишется в тег ele. На карте редактора отметка не показывается: рельефа в ней нет.</p>
      </Section>
      {ways.length > 0 && (
        <Section title="Дороги через узел" aside={<span className="mono count">{ways.length}</span>}>
          <ul className="link-list">
            {ways.map((w) => (
              <li key={w.id} className="detach-row">
                <button onClick={() => select({ type: 'way', id: w.id })}><span>{w.tags.name || w.tags.highway || 'линия'}</span><span className="mono">{w.id}</span></button>
                {ways.length > 1 && (
                  <button className="btn btn-sm btn-quiet" title="Снять эту дорогу с узла: она получит свою точку рядом, её можно увести в сторону"
                    onClick={() => {
                      let moved = '';
                      apply((d) => { const r = detachWay(d, node.id, w.id); moved = r.nodeId; return r.doc; });
                      if (moved) select({ type: 'node', id: moved });
                    }}>Отсоединить</button>
                )}
              </li>
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
