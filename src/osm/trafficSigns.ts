import { insertNodeInWay, setNodeTags, setWayTags } from './edit';
import { withTag } from './tags';
import type { OsmDoc, Tags } from './types';

/**
 * Road signs of the Russian rules (GOST R 52290) placed on the map as OSM nodes, in the
 * standard tags: a node on the road's line with `traffic_sign=RU:<code>` (a value in brackets,
 * `RU:3.24[40]`) and `direction=forward|backward`, the way traffic that sees it goes. Where OSM
 * has a tag of its own the sign writes it as well, so SUMO and the organisers' check understand
 * it: 2.4 and 2.5 are `highway=give_way|stop`, 5.19 is `highway=crossing`, 5.20 is
 * `traffic_calming=bump`, 5.16 is a bus stop, a traffic light is `highway=traffic_signals`.
 */

export type SignGroup = 'Светофоры' | 'Приоритет' | 'Запрещающие' | 'Предписывающие' | 'Особых предписаний' | 'Таблички';

export interface SignDef {
  readonly code: string;
  readonly name: string;
  readonly group: SignGroup;
  /** A number on the sign (speed, weight…), with its default. */
  readonly value?: { readonly label: string; readonly unit: string; readonly default: number };
  /** Tags of the node beside `traffic_sign`; `dir` adds `direction`. */
  readonly tags?: Tags;
  readonly dir?: boolean;
}

export const SIGN_GROUPS: readonly SignGroup[] = ['Светофоры', 'Приоритет', 'Запрещающие', 'Предписывающие', 'Особых предписаний', 'Таблички'];

export const SIGNS: readonly SignDef[] = [
  { code: 'signal', name: 'Светофор', group: 'Светофоры', tags: { highway: 'traffic_signals' } },
  { code: 'signal_ped', name: 'Пешеходный светофор', group: 'Светофоры', tags: { highway: 'crossing', crossing: 'traffic_signals' } },
  { code: '1.8', name: 'Светофорное регулирование', group: 'Светофоры', dir: true },
  { code: '2.1', name: 'Главная дорога', group: 'Приоритет', dir: true },
  { code: '2.2', name: 'Конец главной дороги', group: 'Приоритет', dir: true },
  { code: '2.4', name: 'Уступите дорогу', group: 'Приоритет', tags: { highway: 'give_way' }, dir: true },
  { code: '2.5', name: 'Движение без остановки запрещено', group: 'Приоритет', tags: { highway: 'stop' }, dir: true },
  { code: '3.1', name: 'Въезд запрещён', group: 'Запрещающие', dir: true },
  { code: '3.2', name: 'Движение запрещено', group: 'Запрещающие', dir: true },
  { code: '3.4', name: 'Грузовым запрещено', group: 'Запрещающие', dir: true },
  { code: '3.18.1', name: 'Поворот направо запрещён', group: 'Запрещающие', dir: true },
  { code: '3.18.2', name: 'Поворот налево запрещён', group: 'Запрещающие', dir: true },
  { code: '3.19', name: 'Разворот запрещён', group: 'Запрещающие', dir: true },
  { code: '3.20', name: 'Обгон запрещён', group: 'Запрещающие', dir: true },
  { code: '3.24', name: 'Ограничение скорости', group: 'Запрещающие', dir: true, value: { label: 'Скорость', unit: 'км/ч', default: 40 } },
  { code: '3.27', name: 'Остановка запрещена', group: 'Запрещающие', dir: true },
  { code: '3.28', name: 'Стоянка запрещена', group: 'Запрещающие', dir: true },
  { code: '4.1.1', name: 'Движение прямо', group: 'Предписывающие', dir: true },
  { code: '4.1.2', name: 'Движение направо', group: 'Предписывающие', dir: true },
  { code: '4.1.3', name: 'Движение налево', group: 'Предписывающие', dir: true },
  { code: '5.19', name: 'Пешеходный переход', group: 'Особых предписаний', tags: { highway: 'crossing', crossing: 'uncontrolled' } },
  { code: '5.16', name: 'Остановка автобуса', group: 'Особых предписаний', tags: { highway: 'bus_stop', public_transport: 'platform', bus: 'yes' } },
  { code: '5.20', name: 'Искусственная неровность', group: 'Особых предписаний', tags: { traffic_calming: 'bump' } },
  { code: '5.21', name: 'Жилая зона', group: 'Особых предписаний', dir: true },
  { code: '5.5', name: 'Дорога с односторонним движением', group: 'Особых предписаний', dir: true },
  { code: '8.13', name: 'Направление главной дороги', group: 'Таблички', dir: true },
];

export const signDef = (code: string): SignDef | undefined => SIGNS.find((s) => s.code === code);

/** The `traffic_sign` value of a sign, like `RU:3.24[40]`; none for objects that are only their own tag (a light). */
export const signTagValue = (def: SignDef, value?: number): string | null =>
  def.code.startsWith('signal') ? null : `RU:${def.code}${def.value ? `[${Math.round(value ?? def.value.default)}]` : ''}`;

/** Signs a node carries: its `traffic_sign` codes with their numbers. */
export function signsOf(tags: Tags): Array<{ code: string; value?: number }> {
  const raw = tags.traffic_sign;
  if (!raw) return [];
  const out: Array<{ code: string; value?: number }> = [];
  for (const part of raw.split(/[;,]/)) {
    const m = /^(?:RU:)?([\d.]+)(?:\[(\d+(?:\.\d+)?)\])?$/.exec(part.trim());
    if (m) out.push(m[2] ? { code: m[1], value: Number(m[2]) } : { code: m[1] });
  }
  return out;
}

/** Tags a sign puts on its node, for traffic going `forward` or against the way. */
export function signTags(def: SignDef, forward: boolean, value?: number): Tags {
  const tags: Record<string, string> = { ...(def.tags ?? {}) };
  const ts = signTagValue(def, value);
  if (ts) tags.traffic_sign = ts;
  if (def.dir) tags.direction = forward ? 'forward' : 'backward';
  if (def.code === 'signal') tags['traffic_signals:direction'] = forward ? 'forward' : 'backward';
  return tags;
}

/**
 * Puts a sign on way `wayId` at the point between refs[index] and refs[index + 1], for traffic in
 * the way's direction (`forward`) or against it: a node is added there, or a bare node within
 * `snap` metres is used. 2.1 also marks the way as the main road. Returns the node.
 */
export function placeSign(doc: OsmDoc, wayId: string, index: number, lon: number, lat: number, def: SignDef, forward: boolean, value?: number, near?: string | null): { doc: OsmDoc; nodeId: string | null } {
  const tags: Record<string, string> = { ...signTags(def, forward, value) };
  let d = doc;
  let nodeId = near ?? null;
  if (nodeId && d.nodes[nodeId]) {
    const merged = { ...d.nodes[nodeId].tags };
    // Two signs on one post: the codes go together in one traffic_sign.
    if (tags.traffic_sign && merged.traffic_sign && !merged.traffic_sign.includes(tags.traffic_sign)) tags.traffic_sign = `${merged.traffic_sign};${tags.traffic_sign}`;
    d = setNodeTags(d, nodeId, { ...merged, ...tags });
  } else {
    const added = insertNodeInWay(d, wayId, index, lon, lat);
    if (!added.id) return { doc, nodeId: null };
    nodeId = added.id;
    d = setNodeTags(added.doc, added.id, tags);
  }
  if (def.code === '2.1') {
    const way = d.ways[wayId];
    if (way && !way.tags.priority_road) d = setWayTags(d, wayId, withTag(way.tags, 'priority_road', 'designated'));
  }
  return { doc: d, nodeId };
}

/** Takes one sign off a node, leaving the others and the node itself (it stays a point of the road). */
export function removeSign(doc: OsmDoc, nodeId: string, code: string): OsmDoc {
  const n = doc.nodes[nodeId];
  if (!n) return doc;
  const def = signDef(code);
  let tags: Tags = n.tags;
  const rest = signsOf(n.tags).filter((s) => s.code !== code);
  tags = withTag(tags, 'traffic_sign', rest.length ? rest.map((s) => `RU:${s.code}${s.value !== undefined ? `[${s.value}]` : ''}`).join(';') : null);
  for (const key of Object.keys(def?.tags ?? {})) tags = withTag(tags, key, null);
  if (!rest.length) tags = withTag(withTag(tags, 'direction', null), 'traffic_signals:direction', null);
  return setNodeTags(doc, nodeId, tags);
}
