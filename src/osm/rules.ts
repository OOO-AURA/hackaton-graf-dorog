import { connectCrossing, setNodeTags, setWayTags } from './edit';
import { armsAt, junctions, type Arm } from './lanes';
import { addGiveWay, approachControl, armRefs, CONTROL_REACH, rank, signBack, STREET_RANK } from './signs';
import { legalSpeedTags } from './speeds';
import { isDrivable, withTag } from './tags';
import { isRailLine } from './rail';
import type { OsmDoc, OsmWay, Tags } from './types';

/**
 * The traffic rules (ПДД) kept by the editor itself. After an edit that changes the network the
 * junctions and roads it touched are brought in line; «Привести граф к ПДД» runs them on all.
 *
 * - Priority at a junction without a light: the roads of the highest class are the main road
 *   (sign 2.1, `priority_road`), the approaches of lower streets give way (2.4); roads of one class
 *   keep the right-hand rule (13.11), yard exits give way anyway (8.3) and get nothing. At a light
 *   the priority signs go.
 * - A road without a speed gets the legal one (10.2–10.3): 60 in town, 20 in yards, 110 on a motorway.
 * - A one-way street: 5.5 where it begins, 3.1 «no entry» facing those who would come in at its end.
 * - A living street: 5.21 where it is entered, 5.22 where it is left.
 * - A footpath crossing a carriageway gets a crossing there (5.19), a road crossing rails at grade
 *   a level crossing with sign 1.2 on each approach.
 *
 * Everything placed is marked `source:traffic_sign=auto` (`source:priority_road=auto` on ways): the
 * rules move and remove only what they placed; a sign put by hand is never touched.
 */

export const AUTO_KEY = 'source:traffic_sign';
const AUTO_ROAD_KEY = 'source:priority_road';
export const isAuto = (tags: Tags) => tags[AUTO_KEY] === 'auto';

/** What the rules did, by sign, for the line shown after an edit. */
export type RuleCounts = Record<string, number>;

export interface RuleScope {
  readonly ways: ReadonlySet<string>;
  readonly nodes: ReadonlySet<string>;
}

const add = (c: RuleCounts, key: string, n = 1) => { c[key] = (c[key] ?? 0) + n; };

/** Nodes of an arm within reach of the junction, from it outwards. */
function armNodes(doc: OsmDoc, nodeId: string, arm: Arm, reach = CONTROL_REACH): string[] {
  const way = doc.ways[arm.wayId];
  if (!way) return [];
  const refs = armRefs(way, arm);
  const out: string[] = [];
  const k = Math.cos((doc.nodes[nodeId].lat * Math.PI) / 180);
  let dist = 0;
  for (let i = 1; i < refs.length; i += 1) {
    const [a, b] = [doc.nodes[refs[i - 1]], doc.nodes[refs[i]]];
    if (!a || !b) break;
    dist += Math.hypot((b.lon - a.lon) * k, b.lat - a.lat) * 111_320;
    if (dist > reach) break;
    out.push(b.id);
  }
  return out;
}

const findArm = (doc: OsmDoc, nodeId: string, key: string) => armsAt(doc, nodeId).find((a) => `${a.wayId}:${a.step}` === key);

/** The rules' own priority sign on an arm near the junction, if there is one. */
const autoPriorityOn = (doc: OsmDoc, nodeId: string, arm: Arm): string[] =>
  // Only signs facing traffic that comes into this junction: on a short road the next junction's sign faces the other way.
  armNodes(doc, nodeId, arm).filter((id) => {
    const t = doc.nodes[id].tags;
    return isAuto(t) && (t.highway === 'give_way' || t.highway === 'stop') && t.direction === (arm.step === 1 ? 'backward' : 'forward');
  });

const stripPriority = (doc: OsmDoc, ids: readonly string[]): OsmDoc =>
  ids.reduce((d, id) => setNodeTags(d, id, [AUTO_KEY, 'highway', 'direction', 'traffic_sign'].reduce((acc, k) => withTag(acc, k, null), d.nodes[id].tags)), doc);

/**
 * Priority signs of one junction by the rules (see the top of the file). What is already right is
 * left alone, so running the rules again changes nothing.
 */
function prioritise(doc: OsmDoc, nodeId: string, counts: RuleCounts): OsmDoc {
  let d = doc;
  const arms = armsAt(d, nodeId);
  if (arms.length < 3) return d;
  const lit = d.nodes[nodeId]?.tags.highway === 'traffic_signals' || arms.some((a) => approachControl(d, nodeId, a) === 'signal');
  const ranks = arms.map((a) => rank(d.ways[a.wayId].tags));
  const top = Math.max(...ranks);
  const topArms = arms.filter((_, i) => ranks[i] === top);
  const streets = arms.filter((_, i) => ranks[i] >= STREET_RANK);
  const ruled = !lit && top >= STREET_RANK && topArms.length >= 2 && topArms.length < streets.length;
  const minor = new Set(ruled ? arms.filter((a, i) => ranks[i] < top && ranks[i] >= STREET_RANK && a.lanesIn > 0).map((a) => `${a.wayId}:${a.step}`) : []);
  // Signs of the rules on approaches that should not have one any more (a light, a change of class).
  const stale = arms.filter((a) => !minor.has(`${a.wayId}:${a.step}`)).flatMap((a) => autoPriorityOn(d, nodeId, a));
  if (stale.length) { d = stripPriority(d, stale); add(counts, '−2.4', stale.length); }
  if (!ruled) return d;
  for (const id of new Set(topArms.map((a) => a.wayId))) {
    const w = d.ways[id];
    if (w && !w.tags.priority_road) { d = setWayTags(d, id, { ...w.tags, priority_road: 'designated', [AUTO_ROAD_KEY]: 'auto' }); add(counts, '2.1'); }
  }
  const back = signBack(d, arms);
  for (const key of minor) {
    const arm = findArm(d, nodeId, key);
    // An approach with a sign already, by hand or by the rules, keeps it.
    if (!arm || approachControl(d, nodeId, arm)) continue;
    const tags = { highway: 'give_way', direction: arm.step === 1 ? 'backward' : 'forward', traffic_sign: 'RU:2.4', [AUTO_KEY]: 'auto' };
    const next = addGiveWay(d, nodeId, arm, back, 'give_way', tags);
    if (next !== d) add(counts, '2.4');
    d = next;
  }
  return d;
}

/** Puts a sign `back` metres out along an arm unless one with that code is already there. */
function signOnArm(doc: OsmDoc, nodeId: string, key: string, code: string, outward: boolean, back: number, counts: RuleCounts): OsmDoc {
  const arm = findArm(doc, nodeId, key);
  if (!arm) return doc;
  if (armNodes(doc, nodeId, arm, back + 15).some((id) => (doc.nodes[id].tags.traffic_sign ?? '').includes(`RU:${code}`))) return doc;
  // Traffic going away from the junction along the arm runs with the way when the arm does.
  const forward = outward ? arm.step === 1 : arm.step !== 1;
  const next = addGiveWay(doc, nodeId, arm, back, 'give_way', { traffic_sign: `RU:${code}`, direction: forward ? 'forward' : 'backward', [AUTO_KEY]: 'auto' });
  if (next !== doc) add(counts, code);
  return next;
}

const lengthOf = (doc: OsmDoc, w: OsmWay) => {
  let s = 0;
  for (let i = 1; i < w.refs.length; i += 1) {
    const [a, b] = [doc.nodes[w.refs[i - 1]], doc.nodes[w.refs[i]]];
    if (a && b) s += Math.hypot((b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180), b.lat - a.lat) * 111_320;
  }
  return s;
};

/** 5.5 where a one-way street begins, 3.1 at its end for those who would drive in against it. */
function oneWaySigns(doc: OsmDoc, wayId: string, counts: RuleCounts): OsmDoc {
  const w = doc.ways[wayId];
  if (!w || /_link$/.test(w.tags.highway ?? '') || rank(w.tags) < STREET_RANK) return doc;
  const dir = w.tags.oneway === 'yes' || w.tags.oneway === '1' ? 1 : w.tags.oneway === '-1' ? -1 : 0;
  if (!dir || lengthOf(doc, w) < 40) return doc;
  const [first, last] = [w.refs[0], w.refs[w.refs.length - 1]];
  const [entry, exit] = dir === 1 ? [first, last] : [last, first];
  // Arms of this way at its entry and exit, pointing into the way.
  const inAtEntry = `${wayId}:${entry === first ? 1 : -1}`;
  const inAtExit = `${wayId}:${exit === first ? 1 : -1}`;
  let d = signOnArm(doc, entry, inAtEntry, '5.5', true, 5, counts);
  d = signOnArm(d, exit, inAtExit, '3.1', true, 5, counts);
  return d;
}

/** 5.21 and 5.22 on a living street where it meets another road. */
function livingZoneSigns(doc: OsmDoc, nodeId: string, counts: RuleCounts): OsmDoc {
  const arms = armsAt(doc, nodeId);
  const living = arms.filter((a) => doc.ways[a.wayId]?.tags.highway === 'living_street');
  if (!living.length || living.length === arms.length) return doc;
  let d = doc;
  for (const a of living) {
    const key = `${a.wayId}:${a.step}`;
    d = signOnArm(d, nodeId, key, '5.21', true, 3, counts);
    d = signOnArm(d, nodeId, key, '5.22', false, 7, counts);
  }
  return d;
}

const WALK = new Set(['footway', 'path', 'pedestrian', 'steps', 'cycleway']);
const level = (t: Tags) => (t.bridge && t.bridge !== 'no') || (t.tunnel && t.tunnel !== 'no') ? `x${t.layer ?? ''}` : t.layer ?? '0';

/** Where segment pq meets segment rs strictly inside both: the share along pq and along rs. */
function meet(p: number[], q: number[], r: number[], s: number[]): [number, number] | null {
  const d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0]);
  if (Math.abs(d) < 1e-14) return null;
  const t = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d;
  const u = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d;
  return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98 ? [t, u] : null;
}

/**
 * Joins `wayId` to the ways `other` keeps where they cross on one level without a common node,
 * and tags the new node. Returns the nodes made.
 */
function joinCrossings(doc: OsmDoc, wayId: string, other: (w: OsmWay) => boolean, tags: Tags): { doc: OsmDoc; made: string[] } {
  let d = doc;
  const made: string[] = [];
  const w0 = d.ways[wayId];
  if (!w0) return { doc, made };
  const k = Math.cos(((d.nodes[w0.refs[0]]?.lat ?? 0) * Math.PI) / 180);
  const xy = (id: string) => { const n = d.nodes[id]; return [n.lon * k, n.lat]; };
  const box = (refs: readonly string[]) => {
    const ps = refs.map(xy);
    return [Math.min(...ps.map((p) => p[0])), Math.min(...ps.map((p) => p[1])), Math.max(...ps.map((p) => p[0])), Math.max(...ps.map((p) => p[1]))];
  };
  for (const o of Object.values(d.ways)) {
    if (o.id === wayId || !other(o) || level(o.tags) !== level(w0.tags)) continue;
    let again = true;
    // After each join the indices move: the search starts over until nothing crosses.
    while (again) {
      again = false;
      const w = d.ways[wayId];
      const ow = d.ways[o.id];
      const [a, b] = [box(w.refs), box(ow.refs)];
      if (a[0] > b[2] || b[0] > a[2] || a[1] > b[3] || b[1] > a[3]) break;
      search: for (let i = 0; i + 1 < w.refs.length; i += 1) {
        for (let j = 0; j + 1 < ow.refs.length; j += 1) {
          if (w.refs[i] === ow.refs[j] || w.refs[i] === ow.refs[j + 1] || w.refs[i + 1] === ow.refs[j] || w.refs[i + 1] === ow.refs[j + 1]) continue;
          const m = meet(xy(w.refs[i]), xy(w.refs[i + 1]), xy(ow.refs[j]), xy(ow.refs[j + 1]));
          if (!m) continue;
          const [p, q] = [d.nodes[w.refs[i]], d.nodes[w.refs[i + 1]]];
          const lon = p.lon + (q.lon - p.lon) * m[0];
          const lat = p.lat + (q.lat - p.lat) * m[0];
          const before = new Set(Object.keys(d.nodes));
          d = connectCrossing(d, { wayId, index: i }, { wayId: o.id, index: j }, lon, lat);
          const id = Object.keys(d.nodes).find((n) => !before.has(n));
          if (id) { d = setNodeTags(d, id, { ...d.nodes[id].tags, ...tags }); made.push(id); again = true; }
          break search;
        }
      }
    }
  }
  return { doc: d, made };
}

/** Crossings where footpaths meet carriageways, level crossings where roads meet rails. */
function crossingsOf(doc: OsmDoc, wayId: string, counts: RuleCounts): OsmDoc {
  const w = doc.ways[wayId];
  if (!w) return doc;
  let d = doc;
  if (WALK.has(w.tags.highway ?? '')) {
    const r = joinCrossings(d, wayId, (o) => isDrivable(o.tags) && o.tags.highway !== 'service', { highway: 'crossing', crossing: 'uncontrolled', [AUTO_KEY]: 'auto' });
    d = r.doc;
    add(counts, '5.19', r.made.length);
  }
  const rail = isRailLine(w.tags) && w.tags.railway !== 'subway' && w.tags.railway !== 'tram';
  if (rail || isDrivable(w.tags)) {
    const r = joinCrossings(d, wayId, (o) => (rail ? isDrivable(o.tags) : isRailLine(o.tags) && o.tags.railway !== 'subway' && o.tags.railway !== 'tram'), { railway: 'level_crossing', [AUTO_KEY]: 'auto' });
    d = r.doc;
    // Sign 1.2 on every road approach to the level crossing, 50 m out.
    for (const id of r.made) {
      for (const arm of armsAt(d, id).filter((a) => a.lanesIn > 0)) d = signOnArm(d, id, `${arm.wayId}:${arm.step}`, '1.2', false, 50, counts);
      add(counts, 'переезд');
    }
  }
  return d;
}

/** Applies the rules to what `scope` touched, or to the whole graph. */
export function applyRules(doc: OsmDoc, scope?: RuleScope, opts: { crossings?: boolean; speeds?: boolean } = {}): { doc: OsmDoc; counts: RuleCounts } {
  const counts: RuleCounts = {};
  let d = doc;
  const ways = scope ? [...scope.ways].filter((id) => d.ways[id]) : Object.keys(d.ways);
  // Crossings first: they make new junctions the priority rules then see.
  if (opts.crossings !== false) for (const id of ways) d = crossingsOf(d, id, counts);
  for (const id of ways) {
    const w = d.ways[id];
    if (!w || !isDrivable(w.tags)) continue;
    const t = legalSpeedTags(w.tags);
    if (opts.speeds !== false && t !== w.tags) { d = setWayTags(d, id, t); add(counts, 'скорость'); }
    d = oneWaySigns(d, id, counts);
  }
  const all = new Set(junctions(d));
  const nodes = scope
    ? new Set([...scope.nodes, ...ways.flatMap((id) => d.ways[id]?.refs ?? [])].filter((n) => all.has(n)))
    : all;
  for (const n of nodes) {
    d = prioritise(d, n, counts);
    d = livingZoneSigns(d, n, counts);
  }
  return { doc: d, counts };
}

/** Tags that change what the rules decide; a change of anything else is not the network's. */
const NETWORK_KEYS = ['highway', 'oneway', 'lanes', 'layer', 'bridge', 'tunnel', 'railway', 'junction', 'priority_road'];
/** A node added to a way only to carry a sign or a crossing does not change the network. */
const isPost = (t: Tags) => Boolean(t.traffic_sign || t.highway === 'give_way' || t.highway === 'stop' || t.highway === 'crossing' || t.traffic_calming || t.highway === 'bus_stop' || t.railway === 'level_crossing');

/** What an edit changed in the network: ways drawn, removed, joined or retagged, lights put or taken. */
export function networkChange(prev: OsmDoc, next: OsmDoc): RuleScope | null {
  const ways = new Set<string>();
  const nodes = new Set<string>();
  for (const [id, w] of Object.entries(next.ways)) {
    const p = prev.ways[id];
    if (p === w) continue;
    if (!p) { ways.add(id); continue; }
    if (NETWORK_KEYS.some((k) => p.tags[k] !== w.tags[k])) { ways.add(id); continue; }
    if (p.refs !== w.refs) {
      const before = new Set(p.refs);
      const added = w.refs.filter((r) => !before.has(r));
      const removed = p.refs.filter((r) => !w.refs.includes(r));
      if (removed.length || added.some((r) => !isPost(next.nodes[r]?.tags ?? {}))) ways.add(id);
    }
  }
  for (const [id, w] of Object.entries(prev.ways)) {
    if (!next.ways[id]) { nodes.add(w.refs[0]); nodes.add(w.refs[w.refs.length - 1]); }
  }
  for (const [id, n] of Object.entries(next.nodes)) {
    const p = prev.nodes[id];
    if (p && p !== n && (p.tags.highway === 'traffic_signals') !== (n.tags.highway === 'traffic_signals')) nodes.add(id);
  }
  return ways.size || nodes.size ? { ways, nodes } : null;
}

const NAMES: Readonly<Record<string, string>> = { скорость: 'скорость по ПДД', переезд: 'ж/д переезд', '−2.4': 'снято 2.4' };

/** «ПДД: 2.4 ×2, 2.1, скорость по ПДД» */
export const countsLine = (c: RuleCounts): string | null => {
  const parts = Object.entries(c).filter(([, n]) => n > 0).map(([k, n]) => `${NAMES[k] ?? k}${n > 1 ? ` ×${n}` : ''}`);
  return parts.length ? `По ПДД поставлено: ${parts.join(', ')}` : null;
};

export interface PddGap {
  readonly code: string;
  readonly at: [number, number];
  readonly wayId: string;
  readonly nodeId: string | null;
  readonly missing: boolean;
}

const GAP_NAMES: Readonly<Record<string, string>> = {
  '2.1': 'главная дорога (2.1)', '2.4': '«Уступите дорогу» (2.4)', '5.5': '«Одностороннее движение» (5.5)', '3.1': '«Въезд запрещён» (3.1)',
  '5.21': '«Жилая зона» (5.21)', '5.22': '«Конец жилой зоны» (5.22)',
};
export const gapName = (code: string) => GAP_NAMES[code] ?? code;

/**
 * Where the graph departs from the rules: signs the rules would put (missing) or take away (a
 * priority sign at a light), found by running them on a copy. Crossings and speeds have checks of
 * their own and are left out here, which also keeps this fast enough to run after every edit.
 */
export function pddGaps(doc: OsmDoc): PddGap[] {
  const { doc: d } = applyRules(doc, undefined, { crossings: false, speeds: false });
  const out: PddGap[] = [];
  const wayOf = (id: string, dd: OsmDoc) => Object.values(dd.ways).find((w) => w.refs.includes(id))?.id ?? '';
  for (const [id, n] of Object.entries(d.nodes)) {
    if (!isAuto(n.tags) || doc.nodes[id]?.tags[AUTO_KEY] === 'auto') continue;
    const code = (n.tags.traffic_sign ?? '').replace(/^RU:/, '');
    if (code) out.push({ code, at: [n.lon, n.lat], wayId: wayOf(id, d), nodeId: null, missing: true });
  }
  for (const [id, n] of Object.entries(doc.nodes)) {
    if (isAuto(n.tags) && n.tags.traffic_sign && !isAuto(d.nodes[id]?.tags ?? {})) {
      out.push({ code: n.tags.traffic_sign.replace(/^RU:/, ''), at: [n.lon, n.lat], wayId: wayOf(id, doc), nodeId: id, missing: false });
    }
  }
  for (const [id, w] of Object.entries(d.ways)) {
    if (w.tags[AUTO_ROAD_KEY] === 'auto' && !doc.ways[id]?.tags.priority_road) {
      const mid = d.nodes[w.refs[Math.floor(w.refs.length / 2)]];
      if (mid) out.push({ code: '2.1', at: [mid.lon, mid.lat], wayId: id, nodeId: null, missing: true });
    }
  }
  return out;
}
