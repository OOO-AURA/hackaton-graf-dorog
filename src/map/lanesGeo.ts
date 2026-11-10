import { WayCache, sig } from './wayCache';
import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson';
import { armKey, armsAt, junctionLanes, junctions, turnSide, type Arm, type Turn } from '../osm/lanes';
import { isDrivable } from '../osm/tags';
import { approachControl } from '../osm/signs';
import { isLifted, isLiftedNode } from './elevation';
import type { OsmDoc, Tags } from '../osm/types';
import { along, cumulative, densify, frame, lengthOf, offsetLine, slice, type V } from './polyline';
import { laneOffsetIn, plainSection, roadTapers, sectionAt, sectionOf, widthOf, type Travel } from './section';

/**
 * Geometry of lanes for the map: every lane as a thin line along its road, cut back at
 * junctions; the end of every lane at a junction as a point; and the lane-to-lane links across
 * the junction as curves. Worked out in local metres around each node and turned back into
 * longitude and latitude.
 */

type Props = Record<string, string | number | boolean>;

/** How far lanes stop short of the junction centre, beyond the widest road there. */
const JUNCTION_MARGIN = 2;
const CURVE_POINTS = 14;
/** Points along a taper this far apart, so merging lanes bend smoothly. */
const TAPER_STEP = 1.5;

/** Screen pixels per metre at zoom 17 on MapLibre's 512 px tiles; widths in metres become `w17`. */
export const pxPerMetreZ17 = (lat: number) => 2 ** 17 / (78271.517 * Math.cos((lat * Math.PI) / 180));

/** Lane width of a road: its `width` shared out, else 3.5 m. */
const laneWidth = (tags: Tags): number => sectionOf(tags).lane;

/**
 * Offset of a lane centre from the way's line, metres, positive to the left of the way's
 * direction. Lanes count from the left in their own direction of travel; on a two-way road
 * forward lanes keep to the right of the line and backward ones to the left.
 */
export function laneOffset(tags: Tags, travel: Travel, index: number): number {
  return laneOffsetIn(sectionOf(tags), travel, index);
}

/** Lane markings of a road, the centre line first on a two-way road. */
export function dividerOffsets(tags: Tags): Array<{ offset: number; solid: boolean }> {
  return plainSection(sectionOf(tags)).dividers.map(({ offset, solid }) => ({ offset, solid }));
}

/** Carriageway width in metres: its lanes side by side. */
export function roadWidthMetres(tags: Tags): number {
  return widthOf(sectionOf(tags));
}

const halfWidth = (tags: Tags) => roadWidthMetres(tags) / 2;

const isRaised = (tags: Tags) => Boolean((tags.bridge && tags.bridge !== 'no') || (tags.tunnel && tags.tunnel !== 'no'));

/** How far from the centre of a junction its lanes end. */
export function junctionRadius(doc: OsmDoc, nodeId: string): number {
  return Math.max(...armsAt(doc, nodeId).map((a) => halfWidth(doc.ways[a.wayId].tags)), 3) + JUNCTION_MARGIN;
}

export interface LaneStyle {
  /** Load of a way, volume over capacity, when the flows have been computed. */
  load: (wayId: string) => number | null;
  color: (vc: number | null) => string;
}

/**
 * Lines of every road, stopping short of junctions: `kind: 'lane'` along the middle of each lane
 * (coloured by its load once the flows are computed), `kind: 'divider'` the markings between lanes.
 */
const laneCache = new WayCache<Feature<LineString, Props>[]>();

export function laneLines(doc: OsmDoc, style: LaneStyle): FeatureCollection<LineString, Props> {
  const radius = new Map(junctions(doc).map((id) => [id, junctionRadius(doc, id)]));
  const tapers = roadTapers(doc);
  const features: Feature<LineString, Props>[] = [];
  for (const w of Object.values(doc.ways)) {
    if (!isDrivable(w.tags) || w.refs.length < 2) continue;
    const nodes = w.refs.map((r) => doc.nodes[r]);
    if (nodes.some((n) => !n)) continue;
    const vc = style.load(w.id);
    // In 3D these lanes are on a deck, in a tube or on an embankment, drawn by the 3D scene.
    const raised = isRaised(w.tags) || isLifted(doc, w);
    const wayTapers = tapers.get(w.id);
    const radii = w.refs.map((r) => radius.get(r) ?? -1);
    const color = style.color(vc);
    features.push(...laneCache.get(doc, w, [sig(wayTapers), sig(radii), color, vc !== null, raised], () => {
    const features: Feature<LineString, Props>[] = [];
    const base = sectionOf(w.tags);
    const f = frame(nodes[0].lat);
    const pts = nodes.map((n) => f.to(n.lon, n.lat));
    const dist = cumulative(pts);
    const total = dist[dist.length - 1];
    // Pieces of the way between junctions, each cut back by the junction radius at its ends.
    let start = 0;
    w.refs.forEach((r, i) => {
      if (i === 0 || (!radius.has(r) && i < w.refs.length - 1)) return;
      const from = dist[start] + (radius.get(w.refs[start]) ?? 0);
      const to = dist[i] - (radius.get(r) ?? 0);
      start = i;
      if (to - from <= 0.5) return;
      let line = slice(pts, from, to);
      if (wayTapers) line = densify(line, TAPER_STEP);
      const d = cumulative(line).map((x) => from + x);
      const sections = d.map((x) => sectionAt(base, wayTapers, x, total));
      // Every lane and marking runs while it is in the cross-section: the ones that end at a
      // taper stop where it starts.
      type Item = { key: string; offset: number; props: Props };
      const items = sections.map((sec) => [
        ...sec.lanes.map((l): Item => ({ key: `lane:${l.travel}:${l.index}`, offset: l.offset, props: { way: w.id, kind: 'lane', color, loaded: vc !== null, raised } })),
        ...sec.dividers.map((m): Item => ({ key: `mark:${m.key}`, offset: m.offset, props: { way: w.id, kind: 'divider', solid: m.solid, raised } })),
      ]);
      const keys = [...new Set(items.flatMap((list) => list.map((x) => x.key)))];
      for (const key of keys) {
        let run: Array<{ i: number; item: Item }> = [];
        const flush = () => {
          if (run.length >= 2) {
            const sub = run.map((r) => line[r.i]);
            features.push({ type: 'Feature', properties: run[0].item.props, geometry: { type: 'LineString', coordinates: offsetLine(sub, run.map((r) => r.item.offset)).map(f.back) } });
          }
          run = [];
        };
        items.forEach((list, i) => {
          const item = list.find((x) => x.key === key);
          if (item) run.push({ i, item }); else flush();
        });
        flush();
      }
    });
    return features;
    }));
  }
  return { type: 'FeatureCollection', features };
}

/** Where the lane `index` of an arm meets the edge of the junction, and the arm's outward direction. */
/** Points of an arm in the local frame, from the junction outwards. */
function armPoints(doc: OsmDoc, arm: Arm, f: ReturnType<typeof frame>): V[] {
  const way = doc.ways[arm.wayId];
  const refs = arm.step === 1 ? way.refs.slice(arm.index) : way.refs.slice(0, arm.index + 1).reverse();
  return refs.map((id) => doc.nodes[id]).filter(Boolean).map((n) => f.to(n.lon, n.lat));
}

/** How much of an arm a lane end or an arrow may take: the rest belongs to the junction at its far end. */
const ARM_SHARE = 0.45;
const armLength = (doc: OsmDoc, arm: Arm, f: ReturnType<typeof frame>) => lengthOf(armPoints(doc, arm, f));

function laneEnd(doc: OsmDoc, arm: Arm, coming: boolean, index: number, r: number, f: ReturnType<typeof frame>): { p: V; out: V } {
  const way = doc.ways[arm.wayId];
  const pts = armPoints(doc, arm, f);
  const { p, t } = along(pts, Math.min(r, lengthOf(pts) * ARM_SHARE));
  // Coming in along an arm laid out with the way (+1) is travel against the way, and so on;
  // offsets are to the left of the way, which is the arm's own left only when step is +1.
  const travel = (arm.step === 1) === coming ? 'backward' : 'forward';
  const off = laneOffset(way.tags, travel, index) * arm.step;
  return { p: [p[0] - t[1] * off, p[1] + t[0] * off], out: t };
}

/** Cubic curve from a lane coming in to a lane going out, tangent to both. */
function curve(a: { p: V; out: V }, b: { p: V; out: V }): V[] {
  const k = Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1]) / 2.5;
  const c1: V = [a.p[0] - a.out[0] * k, a.p[1] - a.out[1] * k];
  const c2: V = [b.p[0] - b.out[0] * k, b.p[1] - b.out[1] * k];
  return Array.from({ length: CURVE_POINTS + 1 }, (_, i) => {
    const t = i / CURVE_POINTS;
    const u = 1 - t;
    return [
      u * u * u * a.p[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b.p[0],
      u * u * u * a.p[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b.p[1],
    ];
  });
}

/** How a movement is drawn: straight on, to the left, to the right or back. */
export type TurnGroup = 'through' | 'left' | 'right' | 'uturn';
const GROUP_ORDER: readonly TurnGroup[] = ['left', 'through', 'right', 'uturn'];
export const turnGroup = (t: Turn): TurnGroup => (t === 'reverse' ? 'uturn' : t === 'through' ? 'through' : turnSide(t) < 0 ? 'left' : 'right');

/** Image id of the road arrow for the turns of one lane, like `turn-arrow:left-through`. */
export const arrowIcon = (turns: readonly Turn[]) =>
  `turn-arrow:${GROUP_ORDER.filter((g) => turns.some((t) => turnGroup(t) === g)).join('-') || 'none'}`;

/** How far back from the stop line the lane arrows are painted. */
const ARROW_BACK = 9;
/** The stop line stands a little before the lanes end. */
const STOP_BACK = 1;
/** Room around the lane ends inside the junction outline. */
const AREA_MARGIN = 2.5;

const bearingOf = (v: V) => ((Math.atan2(v[0], v[1]) * 180) / Math.PI + 360) % 360;

/** Convex hull of points (monotone chain), counter-clockwise. */
function hull(points: readonly V[]): V[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: V, a: V, b: V) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: V[]) => list.reduce<V[]>((out, p) => {
    while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
    return [...out, p];
  }, []);
  const lower = half(pts);
  const upper = half([...pts].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** The hull pushed out from its centre by `margin` metres, as a closed ring. */
function grow(ring: readonly V[], margin: number): V[] {
  const c: V = [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
  const out = ring.map((p): V => {
    const d = Math.hypot(p[0] - c[0], p[1] - c[1]) || 1;
    return [p[0] + ((p[0] - c[0]) / d) * margin, p[1] + ((p[1] - c[1]) / d) * margin];
  });
  return [...out, out[0]];
}

type Fc<G extends LineString | Point | Polygon> = FeatureCollection<G, Props>;

/**
 * Everything drawn at junctions: the lane-to-lane links as ribbons coloured by turn group, the
 * junction outline, a stop line on every approach and the turn arrows painted on the lanes coming
 * in. The lane ends, where links are dragged from and to, only at `withEnds`, the junction being
 * edited.
 */
export function junctionGeometry(doc: OsmDoc, nodeIds: readonly string[], withEnds: string | null, style: LaneStyle) {
  const ends: Feature<Point, Props>[] = [];
  const links: Feature<LineString, Props>[] = [];
  const areas: Feature<Polygon, Props>[] = [];
  const stops: Feature<LineString, Props>[] = [];
  const arrows: Feature<Point, Props>[] = [];
  for (const nodeId of nodeIds) {
    const node = doc.nodes[nodeId];
    if (!node) continue;
    const f = frame(node.lat);
    const px = pxPerMetreZ17(node.lat);
    const r = junctionRadius(doc, nodeId) - (JUNCTION_MARGIN - 0.5);
    const lanes = junctionLanes(doc, nodeId);
    const endOf = (arm: Arm, coming: boolean, i: number) => laneEnd(doc, arm, coming, i, r, f);
    const edit = nodeId === withEnds;
    const raisedWay = (wayId: string) => Boolean(doc.ways[wayId]) && (isRaised(doc.ways[wayId].tags) || isLifted(doc, doc.ways[wayId]));
    // A junction up on an embankment: in 3D its flat drawing would lie on the ground under it.
    const lifted = isLiftedNode(doc, nodeId);
    lanes.links.forEach((l) => {
      const a = endOf(l.from, true, l.fromLane);
      const b = endOf(l.to, false, l.toLane);
      links.push({
        type: 'Feature',
        properties: {
          node: nodeId, from: armKey(l.from), lane: l.fromLane, to: armKey(l.to), turn: l.turn, group: turnGroup(l.turn),
          w17: laneWidth(doc.ways[l.from.wayId].tags) * px, color: style.color(style.load(l.from.wayId)), edit,
          raised: lifted,
        },
        geometry: { type: 'LineString', coordinates: curve(a, b).map(f.back) },
      });
    });
    const corners: V[] = [];
    for (const arm of lanes.arms) {
      const tags = doc.ways[arm.wayId].tags;
      const w = laneWidth(tags);
      const inEnds = Array.from({ length: arm.lanesIn }, (_, i) => endOf(arm, true, i));
      const outEnds = Array.from({ length: arm.lanesOut }, (_, i) => endOf(arm, false, i));
      [...inEnds, ...outEnds].forEach((e) => corners.push(e.p));
      if (edit) {
        inEnds.forEach((e, i) => ends.push({ type: 'Feature', properties: { node: nodeId, arm: armKey(arm), lane: i, kind: 'in' }, geometry: { type: 'Point', coordinates: f.back(e.p) } }));
        outEnds.forEach((e, i) => ends.push({ type: 'Feature', properties: { node: nodeId, arm: armKey(arm), lane: i, kind: 'out' }, geometry: { type: 'Point', coordinates: f.back(e.p) } }));
      }
      if (!inEnds.length) continue;
      const out = inEnds[0].out;
      const across: V = [-out[1], out[0]];
      const proj = inEnds.map((e) => e.p[0] * across[0] + e.p[1] * across[1]);
      const lo = inEnds[proj.indexOf(Math.min(...proj))].p;
      const hi = inEnds[proj.indexOf(Math.max(...proj))].p;
      const at = (p: V, side: number, back: number): V => [p[0] + across[0] * side * (w / 2) + out[0] * back, p[1] + across[1] * side * (w / 2) + out[1] * back];
      // A stop line only where traffic has to stop: a light or a stop sign; a give-way sign has its
      // own dashed line (marking 1.13). A junction with neither has no line at all, as on the street.
      const control = approachControl(doc, nodeId, arm);
      if (control) {
        stops.push({
          type: 'Feature', properties: { node: nodeId, w17: (control === 'give_way' ? 0.6 : 0.4) * px, kind: control === 'give_way' ? 'yield' : 'stop', raised: lifted },
          geometry: { type: 'LineString', coordinates: [at(lo, -1, STOP_BACK), at(hi, 1, STOP_BACK)].map(f.back) },
        });
      }
      const approach = lanes.approaches.find((ap) => armKey(ap.arm) === armKey(arm));
      // Arrows stand on the lane itself, followed along the road: on a short or bent approach (a
      // U-turn link) a point straight back from the stop line would land off the road, so a road
      // too short to hold one gets none.
      const back = r + ARROW_BACK;
      if (armLength(doc, arm, f) * ARM_SHARE >= back) {
        inEnds.forEach((_, i) => {
          const at = laneEnd(doc, arm, true, i, back, f);
          arrows.push({
            type: 'Feature',
            properties: { node: nodeId, icon: arrowIcon(approach?.turns[i] ?? []), bearing: bearingOf([-at.out[0], -at.out[1]]), w17: w * px, raised: lifted || raisedWay(arm.wayId) },
            geometry: { type: 'Point', coordinates: f.back(at.p) },
          });
        });
      }
    }
    if (corners.length >= 3) {
      areas.push({ type: 'Feature', properties: { node: nodeId, edit, raised: lifted }, geometry: { type: 'Polygon', coordinates: [grow(hull(corners), AREA_MARGIN).map(f.back)] } });
    }
  }
  const fc = <G extends LineString | Point | Polygon>(features: Feature<G, Props>[]) => ({ type: 'FeatureCollection', features }) as Fc<G>;
  return { ends: fc(ends), links: fc(links), areas: fc(areas), stops: fc(stops), arrows: fc(arrows) };
}

/** Depth of a zebra along the road, metres, and how far it reaches past the carriageway. */
const ZEBRA_DEPTH = 3;
const ZEBRA_MARGIN = 0.5;

const isCrossing = (tags: Tags) => tags.highway === 'crossing' || Boolean(tags.crossing && tags.crossing !== 'no');

/** Zebra crossings: at every crossing node on a road, a band across the carriageway. */
export function zebras(doc: OsmDoc): Fc<LineString> {
  const features: Feature<LineString, Props>[] = [];
  const done = new Set<string>();
  for (const w of Object.values(doc.ways)) {
    if (!isDrivable(w.tags)) continue;
    w.refs.forEach((id, i) => {
      const n = doc.nodes[id];
      if (!n || done.has(id) || !isCrossing(n.tags)) return;
      const a = doc.nodes[w.refs[Math.max(0, i - 1)]];
      const b = doc.nodes[w.refs[Math.min(w.refs.length - 1, i + 1)]];
      if (!a || !b || a === b) return;
      done.add(id);
      const f = frame(n.lat);
      const [pa, pb, p] = [f.to(a.lon, a.lat), f.to(b.lon, b.lat), f.to(n.lon, n.lat)];
      const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) || 1;
      const across: V = [-(pb[1] - pa[1]) / len, (pb[0] - pa[0]) / len];
      const half = halfWidth(w.tags) + ZEBRA_MARGIN;
      features.push({
        type: 'Feature',
        properties: { node: id, w17: ZEBRA_DEPTH * pxPerMetreZ17(n.lat) },
        geometry: { type: 'LineString', coordinates: [[p[0] - across[0] * half, p[1] - across[1] * half], [p[0] + across[0] * half, p[1] + across[1] * half]].map((q) => f.back(q as V)) },
      });
    });
  }
  return { type: 'FeatureCollection', features };
}
