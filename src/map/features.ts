import { setNodeTags } from '../osm/edit';
import { withTag } from '../osm/tags';
import type { OsmDoc, Tags } from '../osm/types';

/**
 * Traffic-control objects placed on road nodes, written with the standard OSM tags the
 * simulators' importers read. Each one says which tags it owns, so toggling it off
 * removes exactly what it added.
 */
export interface NodeFeature {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly tags: Tags;
}

export const NODE_FEATURES: readonly NodeFeature[] = [
  { id: 'signal', label: 'Светофор', hint: 'highway=traffic_signals. SUMO строит по нему светофорный объект, MATSim снижает пропускную способность.', tags: { highway: 'traffic_signals' } },
  { id: 'crossing', label: 'Пешеходный переход', hint: 'highway=crossing, crossing=uncontrolled. SUMO ставит переход на перекрёстке, Webots рисует зебру.', tags: { highway: 'crossing', crossing: 'uncontrolled' } },
  { id: 'give_way', label: 'Уступи дорогу', hint: 'Знак 2.4, highway=give_way на узле перед перекрёстком. Ставьте на второстепенной дороге; на карте у въезда появится пунктирная линия 1.13.', tags: { highway: 'give_way' } },
  { id: 'stop', label: 'Стоп', hint: 'Знак 2.5, highway=stop на узле перед перекрёстком: движение без остановки запрещено, на карте у въезда появится стоп-линия.', tags: { highway: 'stop' } },
  { id: 'station', label: 'Ж/д станция', hint: 'railway=station, public_transport=station на узле пути. На карте значок и название, правится в инспекторе.', tags: { railway: 'station', public_transport: 'station' } },
  { id: 'halt', label: 'Остановочный пункт', hint: 'railway=halt: посадка без станционных путей, как платформа электрички.', tags: { railway: 'halt', public_transport: 'station' } },
  { id: 'tram_stop', label: 'Трамвайная остановка', hint: 'railway=tram_stop, public_transport=stop_position на узле трамвайного пути.', tags: { railway: 'tram_stop', public_transport: 'stop_position' } },
  { id: 'bump', label: 'Лежачий полицейский', hint: 'traffic_calming=bump. Отмечает искусственную неровность, машины перед ней сбрасывают скорость.', tags: { traffic_calming: 'bump' } },
];

export const featureById = (id: string): NodeFeature => NODE_FEATURES.find((f) => f.id === id) ?? NODE_FEATURES[0];

export const hasFeature = (tags: Tags, f: NodeFeature): boolean => Object.entries(f.tags).every(([k, v]) => tags[k] === v);

/** Adds the feature to the node, or removes it if the node already has it. */
export function toggleNodeFeature(doc: OsmDoc, nodeId: string, f: NodeFeature): OsmDoc {
  const node = doc.nodes[nodeId];
  if (!node) return doc;
  const on = hasFeature(node.tags, f);
  const tags = Object.entries(f.tags).reduce((acc, [k, v]) => withTag(acc, k, on ? null : v), node.tags);
  return setNodeTags(doc, nodeId, tags);
}

/** Map symbol for a node, by priority; empty when the node carries no traffic-control object. */
export function nodeSymbol(tags: Tags): string {
  if (tags.highway === 'traffic_signals') return 'signal';
  if (tags.highway === 'crossing' || tags.crossing) return 'crossing';
  // STOP and give way are drawn as road signs beside the approach (roadSigns.ts).
  if (tags.highway === 'bus_stop') return 'bus_stop';
  if (tags.traffic_calming) return 'bump';
  return '';
}
