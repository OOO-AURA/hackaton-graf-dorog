import type { Feature, FeatureCollection, Point } from 'geojson';
import { insertNodeInWay, setNodeTags, setWayTags } from './edit';
import { armsAt, junctions, type Arm } from './lanes';
import { lanesByDirection } from './profile';
import { isDrivable, withTag } from './tags';
import type { OsmDoc, OsmWay, Tags } from './types';

/**
 * Priority signs of the Russian traffic rules in standard OSM tags, so the file stays readable by
 * every importer: `highway=give_way` (sign 2.4) and `highway=stop` (2.5) on a node of the approach
 * with `direction=forward|backward`, `priority_road=designated` on the ways of the main road (2.1).
 * Crossings (5.19) come from `highway=crossing`. Signs are drawn in 2D only.
 *
 * OSM has none of these in the task area, so they can be placed by the rules: at a junction without
 * a traffic light, the roads of the highest class are the main road and the others give way. Roads
 * of one class get nothing, as the right-hand rule then applies (ПДД 13.11).
 */

export type ApproachControl = 'signal' | 'stop' | 'give_way' | null;
export type SignKind = 'give_way' | 'stop' | 'main_road' | 'crossing';

/** How far from a junction a light or sign on the approach still controls it, metres. */
const CONTROL_REACH = 40;
/** Where a placed give-way sign stands, metres before the junction centre (beyond the widest road). */
const SIGN_BACK_MIN = 10;
const SIGN_BACK_MARGIN = 4;
/** Distance of a sign from the edge of the carriageway, metres. */
const SIGN_SIDE = 1.5;
/** Main road signs stand a little further back than give-way ones. */
const MAIN_SIGN_EXTRA = 6;
/** A node this close to where the sign should go is used instead of adding one. */
const SNAP = 1.5;
const LANE_WIDTH = 3.5;

/** Class rank of a road for the main road: higher wins; a link ranks under its road. */
const RANK: Readonly<Record<string, number>> = {
  motorway: 9, trunk: 8, primary: 7, secondary: 6, tertiary: 5, unclassified: 4, residential: 3, living_street: 2, service: 1,
};
/**
 * Yard driveways and living streets need no sign: whoever leaves them gives way anyway (ПДД 8.3,
 * 17.3), so only streets of this rank and up take part in the main road.
 */
const STREET_RANK = RANK.residential;
const rank = (tags: Tags) => {
  const h = tags.highway ?? '';
  return h.endsWith('_link') ? (RANK[h.slice(0, -5)] ?? 0) - 0.5 : RANK[h] ?? 0;
};

const M_PER_DEG = (Math.PI / 180) * 6_371_000;
type V = [number, number];
function frame(lat0: number) {
  const k = Math.cos((lat0 * Math.PI) / 180);
  return {
    to: (lon: number, lat: number): V => [lon * M_PER_DEG * k, lat * M_PER_DEG],
    back: ([x, y]: V): V => [x / (M_PER_DEG * k), y / M_PER_DEG],
  };
}

const halfWidth = (tags: Tags) => {
  const w = Number.parseFloat(tags.width ?? '');
  if (Number.isFinite(w) && w > 0) return w / 2;
  const { forward, backward } = lanesByDirection(tags);
  return ((forward + backward) * LANE_WIDTH) / 2;
};

/** Node ids along an arm, from the junction outwards. */
function armRefs(way: OsmWay, arm: Arm): string[] {
  return arm.step === 1 ? way.refs.slice(arm.index) : way.refs.slice(0, arm.index + 1).reverse();
}

/** What controls traffic coming into the junction along an arm: a light, a stop or give-way sign, or nothing. */
export function approachControl(doc: OsmDoc, nodeId: string, arm: Arm): ApproachControl {
  if (doc.nodes[nodeId]?.tags.highway === 'traffic_signals') return 'signal';
  const way = doc.ways[arm.wayId];
  if (!way) return null;
  const refs = armRefs(way, arm);
  const f = frame(doc.nodes[nodeId].lat);
  let dist = 0;
  for (let i = 1; i < refs.length; i += 1) {
    const [a, b] = [doc.nodes[refs[i - 1]], doc.nodes[refs[i]]];
    if (!a || !b) break;
    const [pa, pb] = [f.to(a.lon, a.lat), f.to(b.lon, b.lat)];
    dist += Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
    if (dist > CONTROL_REACH) break;
    const h = b.tags.highway;
    if (h === 'traffic_signals') return 'signal';
    if (h === 'stop') return 'stop';
    if (h === 'give_way') return 'give_way';
  }
  return null;
}

/** Travel direction of traffic coming in along an arm, in the way's terms. */
const incomingDirection = (arm: Arm) => (arm.step === 1 ? 'backward' : 'forward');

/** Puts a give-way sign on the arm `back` metres from the junction, on a node there or a new one. */
function addGiveWay(doc: OsmDoc, nodeId: string, arm: Arm, back: number): OsmDoc {
  const way = doc.ways[arm.wayId];
  const refs = armRefs(way, arm);
  const f = frame(doc.nodes[nodeId].lat);
  const tags = { highway: 'give_way', direction: incomingDirection(arm) };
  let dist = 0;
  for (let i = 1; i < refs.length; i += 1) {
    const [a, b] = [doc.nodes[refs[i - 1]], doc.nodes[refs[i]]];
    const [pa, pb] = [f.to(a.lon, a.lat), f.to(b.lon, b.lat)];
    const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
    if (dist + len < back - SNAP) { dist += len; continue; }
    // A plain vertex near the spot carries the sign; otherwise a node is added on the segment.
    if (Math.abs(dist + len - back) <= SNAP && !Object.keys(b.tags).length) return setNodeTags(doc, b.id, tags);
    const k = Math.min(1, Math.max(0, (back - dist) / (len || 1)));
    const [lon, lat] = f.back([pa[0] + (pb[0] - pa[0]) * k, pa[1] + (pb[1] - pa[1]) * k]);
    const at = way.refs.indexOf(arm.step === 1 ? a.id : b.id);
    const added = insertNodeInWay(doc, way.id, at, lon, lat);
    return added.id ? setNodeTags(added.doc, added.id, tags) : doc;
  }
  return doc;
}

const signBack = (doc: OsmDoc, arms: readonly Arm[]) =>
  Math.max(SIGN_BACK_MIN, Math.max(...arms.map((a) => halfWidth(doc.ways[a.wayId].tags))) + SIGN_BACK_MARGIN);

/**
 * Places priority signs by the rules at every junction without a traffic light: the roads of the
 * highest class become the main road, the other approaches get a give-way sign. Approaches that
 * already have a sign keep it, so placing again adds nothing.
 */
export function placeRuleSigns(doc: OsmDoc): { doc: OsmDoc; giveWay: number; mainRoads: number } {
  let d = doc;
  let giveWay = 0;
  const main = new Set<string>();
  for (const nodeId of junctions(doc)) {
    const arms = armsAt(d, nodeId);
    if (arms.some((a) => approachControl(d, nodeId, a) === 'signal')) continue;
    const ranks = arms.map((a) => rank(d.ways[a.wayId].tags));
    const top = Math.max(...ranks);
    const topArms = arms.filter((_, i) => ranks[i] === top);
    const streets = arms.filter((_, i) => ranks[i] >= STREET_RANK);
    // Equal streets keep the right-hand rule; a street with only driveways onto it needs no sign.
    if (top < STREET_RANK || topArms.length < 2 || topArms.length === streets.length) continue;
    topArms.forEach((a) => main.add(a.wayId));
    const back = signBack(d, arms);
    const minor = arms.filter((a, i) => ranks[i] < top && ranks[i] >= STREET_RANK && a.lanesIn > 0 && !approachControl(d, nodeId, a)).map((a) => a.wayId + ':' + a.step);
    for (const key of minor) {
      // Arms are found again after each sign: adding a node shifts the indices on that way.
      const arm = armsAt(d, nodeId).find((a) => `${a.wayId}:${a.step}` === key);
      if (!arm) continue;
      const next = addGiveWay(d, nodeId, arm, back);
      if (next !== d) giveWay += 1;
      d = next;
    }
  }
  let mainRoads = 0;
  for (const id of main) {
    const way = d.ways[id];
    if (!way || way.tags.priority_road) continue;
    d = setWayTags(d, id, withTag(way.tags, 'priority_road', 'designated'));
    mainRoads += 1;
  }
  return { doc: d, giveWay, mainRoads };
}

type SignFeature = Feature<Point, { sign: SignKind; node: string }>;

/** A sign on the right of traffic going from `a` to `b`, `before` metres back from `at`. */
function rightOf(f: ReturnType<typeof frame>, a: V, b: V, at: V, side: number, before = 0): V {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const t: V = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  return f.back([at[0] + t[1] * side - t[0] * before, at[1] - t[0] * side - t[1] * before]);
}

const isCrossing = (tags: Tags) => tags.highway === 'crossing';

/** Where the signs stand on the map: on the right of the road, before what they announce. */
export function signPoints(doc: OsmDoc): FeatureCollection<Point, { sign: SignKind; node: string }> {
  const features: SignFeature[] = [];
  const push = (sign: SignKind, node: string, at: V) => features.push({ type: 'Feature', properties: { sign, node }, geometry: { type: 'Point', coordinates: at } });
  for (const w of Object.values(doc.ways)) {
    if (!isDrivable(w.tags)) continue;
    const side = halfWidth(w.tags) + SIGN_SIDE;
    const { forward, backward } = lanesByDirection(w.tags);
    const twoWay = forward > 0 && backward > 0 && w.tags.oneway !== 'yes';
    w.refs.forEach((id, i) => {
      const n = doc.nodes[id];
      const kind = n?.tags.highway;
      if (!n || (kind !== 'give_way' && kind !== 'stop' && !(isCrossing(n.tags) && rank(w.tags) >= RANK.residential))) return;
      const prev = doc.nodes[w.refs[Math.max(0, i - 1)]];
      const next = doc.nodes[w.refs[Math.min(w.refs.length - 1, i + 1)]];
      if (!prev || !next || prev === next) return;
      const f = frame(n.lat);
      const [pa, pb, p] = [f.to(prev.lon, prev.lat), f.to(next.lon, next.lat), f.to(n.lon, n.lat)];
      if (kind === 'give_way' || kind === 'stop') {
        const backward = n.tags.direction === 'backward';
        push(kind, id, backward ? rightOf(f, pb, pa, p, side) : rightOf(f, pa, pb, p, side));
        return;
      }
      push('crossing', id, rightOf(f, pa, pb, p, side, 2));
      if (twoWay) push('crossing', id, rightOf(f, pb, pa, p, side, 2));
    });
  }
  for (const nodeId of junctions(doc)) {
    const arms = armsAt(doc, nodeId);
    const isMain = (a: Arm) => doc.ways[a.wayId].tags.priority_road === 'designated';
    if (!arms.some(isMain) || arms.every(isMain)) continue;
    const back = signBack(doc, arms) + MAIN_SIGN_EXTRA;
    const f = frame(doc.nodes[nodeId].lat);
    for (const arm of arms.filter((a) => isMain(a) && a.lanesIn > 0)) {
      const way = doc.ways[arm.wayId];
      const refs = armRefs(way, arm).map((r) => doc.nodes[r]).filter(Boolean);
      if (refs.length < 2) continue;
      const [p0, p1] = [f.to(refs[0].lon, refs[0].lat), f.to(refs[1].lon, refs[1].lat)];
      const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      const k = Math.min(1, back / (len || 1));
      const at: V = [p0[0] + (p1[0] - p0[0]) * k, p0[1] + (p1[1] - p0[1]) * k];
      // Traffic comes in from p1 towards the junction p0.
      push('main_road', nodeId, rightOf(f, p1, p0, at, halfWidth(way.tags) + SIGN_SIDE));
    }
  }
  return { type: 'FeatureCollection', features };
}
