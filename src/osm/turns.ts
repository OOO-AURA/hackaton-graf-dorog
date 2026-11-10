/**
 * Turns at a junction, like the Turns object of PTV Visum, stored as standard OSM
 * `type=restriction` relations (from way, via node, to way). SUMO netconvert reads them and
 * removes the forbidden connections, so a turn ban drawn here shows up in the micro simulation.
 *
 * OSM wants the `from` and `to` ways to start or end at the via node. A way that passes through
 * the junction is split there first; the split keeps its relations (see splitWay).
 */
import { splitWay, waysOfNode } from './edit';
import { direction, isDrivable } from './tags';
import type { OsmDoc, OsmMember, OsmRelation, Tags } from './types';

export type TurnKind = 'straight' | 'left' | 'right' | 'uturn';

/** One road leaving the junction. `side` says where the junction is on the way. */
export interface Arm {
  readonly key: string;
  readonly wayId: string;
  readonly side: 'start' | 'end' | 'before' | 'after';
  /** Compass bearing from the junction along this arm, degrees clockwise from north. */
  readonly bearing: number;
  readonly name: string;
  readonly canEnter: boolean;
  readonly canExit: boolean;
}

export interface Turn {
  readonly from: Arm;
  readonly to: Arm;
  readonly kind: TurnKind;
  readonly allowed: boolean;
}

const STRAIGHT_DEG = 35;
const UTURN_DEG = 155;
const COMPASS = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'] as const;

function bearing(doc: OsmDoc, fromId: string, toId: string): number {
  const a = doc.nodes[fromId];
  const b = doc.nodes[toId];
  const kx = Math.cos((a.lat * Math.PI) / 180);
  const deg = (Math.atan2((b.lon - a.lon) * kx, b.lat - a.lat) * 180) / Math.PI;
  return (deg + 360) % 360;
}

export const compass = (deg: number) => COMPASS[Math.round(deg / 45) % 8];

/** Arms of a junction: each drivable way gives one arm per neighbour vertex of the node. */
export function junctionArms(doc: OsmDoc, nodeId: string): Arm[] {
  return waysOfNode(doc, nodeId).filter((w) => isDrivable(w.tags)).flatMap((w) => {
    const dir = direction(w.tags);
    const i = w.refs.indexOf(nodeId);
    const last = w.refs.length - 1;
    const arm = (side: Arm['side'], neighbour: string, towardsNodeIsForward: boolean): Arm => ({
      key: `${w.id}:${side}`, wayId: w.id, side, bearing: bearing(doc, nodeId, neighbour), name: w.tags.name ?? '',
      canEnter: dir === 'both' || (dir === 'forward') === towardsNodeIsForward,
      canExit: dir === 'both' || (dir === 'forward') !== towardsNodeIsForward,
    });
    const arms: Arm[] = [];
    if (i > 0) arms.push(arm(i === last ? 'end' : 'before', w.refs[i - 1], true));
    if (i < last) arms.push(arm(i === 0 ? 'start' : 'after', w.refs[i + 1], false));
    return arms;
  });
}

/** Kind of turn from the travel heading into the junction to the heading out of it. */
export function turnKind(from: Arm, to: Arm): TurnKind {
  if (from.key === to.key) return 'uturn';
  const headingIn = (from.bearing + 180) % 360;
  const delta = ((to.bearing - headingIn + 540) % 360) - 180;
  if (Math.abs(delta) <= STRAIGHT_DEG) return 'straight';
  if (Math.abs(delta) >= UTURN_DEG) return 'uturn';
  return delta > 0 ? 'right' : 'left';
}

const RESTRICTION_KEY = 'restriction';
const NO_PREFIX = 'no_';
const ONLY_PREFIX = 'only_';
const RESTRICTION_FOR: Readonly<Record<TurnKind, string>> = {
  straight: 'no_straight_on', left: 'no_left_turn', right: 'no_right_turn', uturn: 'no_u_turn',
};

const member = (r: OsmRelation, role: string, type: OsmMember['type']) => r.members.find((m) => m.role === role && m.type === type)?.ref;

/** Turn restrictions with this node as `via`. */
export function restrictionsAt(doc: OsmDoc, nodeId: string): OsmRelation[] {
  return Object.values(doc.relations).filter((r) => r.tags.type === 'restriction' && member(r, 'via', 'node') === nodeId);
}

function restrictionValue(tags: Tags): string {
  return tags[RESTRICTION_KEY] ?? tags['restriction:motorcar'] ?? '';
}

/** Is driving from way `fromId` to way `toId` through the node allowed by the relations? */
export function turnAllowed(doc: OsmDoc, nodeId: string, fromId: string, toId: string): boolean {
  const own = restrictionsAt(doc, nodeId).filter((r) => member(r, 'from', 'way') === fromId);
  const only = own.filter((r) => restrictionValue(r.tags).startsWith(ONLY_PREFIX));
  if (only.length) return only.some((r) => member(r, 'to', 'way') === toId);
  return !own.some((r) => restrictionValue(r.tags).startsWith(NO_PREFIX) && member(r, 'to', 'way') === toId);
}

/** Every movement through the junction that the one-way rules allow, with its restriction state. */
export function junctionTurns(doc: OsmDoc, nodeId: string): Turn[] {
  const arms = junctionArms(doc, nodeId);
  return arms.filter((a) => a.canEnter).flatMap((from) => arms.filter((to) => to.canExit).map((to) => ({
    from, to, kind: turnKind(from, to), allowed: turnAllowed(doc, nodeId, from.wayId, to.wayId),
  })));
}

const angleGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

/** The arm of the current document that points the same way as `arm` did. */
function findArm(doc: OsmDoc, nodeId: string, arm: Arm): Arm | undefined {
  const arms = junctionArms(doc, nodeId);
  return arms.find((a) => a.key === arm.key) ?? [...arms].sort((x, y) => angleGap(x.bearing, arm.bearing) - angleGap(y.bearing, arm.bearing))[0];
}

/** Splits a way passing through the junction so the arm becomes a way ending there; returns that way. */
function armWay(doc: OsmDoc, nodeId: string, arm: Arm): { doc: OsmDoc; wayId: string } {
  const current = findArm(doc, nodeId, arm) ?? arm;
  if (current.side === 'start' || current.side === 'end') return { doc, wayId: current.wayId };
  const { doc: split, newWayId } = splitWay(doc, current.wayId, nodeId);
  if (!newWayId) return { doc, wayId: current.wayId };
  return { doc: split, wayId: current.side === 'before' ? current.wayId : newWayId };
}

function putRelation(doc: OsmDoc, rel: OsmRelation): OsmDoc {
  return { ...doc, relations: { ...doc.relations, [rel.id]: rel } };
}

function dropRelation(doc: OsmDoc, id: string): OsmDoc {
  const { [id]: _removed, ...relations } = doc.relations;
  return { ...doc, relations, deleted: { ...doc.deleted, [`relation:${id}`]: true } };
}

/** `only_*` restrictions of this approach are rewritten as the equivalent set of `no_*` ones, so single turns can be toggled. */
function expandOnly(doc: OsmDoc, nodeId: string, fromId: string): OsmDoc {
  const only = restrictionsAt(doc, nodeId).filter((r) => member(r, 'from', 'way') === fromId && restrictionValue(r.tags).startsWith(ONLY_PREFIX));
  if (!only.length) return doc;
  const allowedTo = new Set(only.map((r) => member(r, 'to', 'way')));
  const fromArm = junctionArms(doc, nodeId).find((a) => a.wayId === fromId && a.canEnter);
  const banned = junctionArms(doc, nodeId).filter((a) => a.canExit && !allowedTo.has(a.wayId));
  const cleared = only.reduce((d, r) => dropRelation(d, r.id), doc);
  return banned.reduce((d, to) => addBan(d, nodeId, fromId, to.wayId, fromArm ? turnKind(fromArm, to) : 'straight'), cleared);
}

function addBan(doc: OsmDoc, nodeId: string, fromId: string, toId: string, kind: TurnKind): OsmDoc {
  const id = String(doc.nextId);
  const rel: OsmRelation = {
    id, attrs: { version: '1' },
    members: [{ type: 'way', ref: fromId, role: 'from' }, { type: 'node', ref: nodeId, role: 'via' }, { type: 'way', ref: toId, role: 'to' }],
    tags: { type: 'restriction', [RESTRICTION_KEY]: RESTRICTION_FOR[kind] },
  };
  return putRelation({ ...doc, nextId: doc.nextId + 1 }, rel);
}

/** Allows or forbids one movement through the junction. */
export function setTurnAllowed(doc: OsmDoc, nodeId: string, from: Arm, to: Arm, allowed: boolean): OsmDoc {
  const kind = turnKind(from, to);
  const a = armWay(doc, nodeId, from);
  // A U-turn on a way passing through goes back along the same piece, which keeps the from id.
  const b = from.key === to.key ? { doc: a.doc, wayId: a.wayId } : armWay(a.doc, nodeId, to);
  const fromId = a.wayId;
  const toId = b.wayId;
  const expanded = expandOnly(b.doc, nodeId, fromId);
  if (turnAllowed(expanded, nodeId, fromId, toId) === allowed) return expanded;
  if (!allowed) return addBan(expanded, nodeId, fromId, toId, kind);
  return restrictionsAt(expanded, nodeId)
    .filter((r) => member(r, 'from', 'way') === fromId && member(r, 'to', 'way') === toId && restrictionValue(r.tags).startsWith(NO_PREFIX))
    .reduce((d, r) => dropRelation(d, r.id), expanded);
}

export const isJunction = (doc: OsmDoc, nodeId: string): boolean => junctionArms(doc, nodeId).length >= 3;

export const TURN_LABELS: Readonly<Record<TurnKind, string>> = { straight: 'прямо', left: 'налево', right: 'направо', uturn: 'разворот' };

export const armLabel = (arm: Arm) => `${arm.name || 'без названия'}, ${compass(arm.bearing)}`;

