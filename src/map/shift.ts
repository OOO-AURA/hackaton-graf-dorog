import { isDrivable } from '../osm/tags';
import type { OsmDoc, OsmWay } from '../osm/types';
import { frame, offsetLine, type V } from './polyline';
import { edgesOf, isMinor, roadTapers, sectionOf, SIDE_BY_SIDE, widthOf, type Section, type Taper } from './section';

/**
 * Roads that leave a node side by side are often mapped with lines closer together than their
 * widths, and drawn on those lines they lie on top of each other for the first tens of metres.
 * Two cases are drawn apart, everything else stays on its line:
 *
 * - a fork: a road ends and the roads going on from it side by side carry all its lanes between
 *   them (a dual carriageway splitting, slip roads leaving at the end of a bridge). Each starts on
 *   its own part of the wide road and moves over to its own line;
 * - a slip road (`*_link`) that leaves or joins a main road nearly parallel and runs inside it
 *   for a while. It grows out of the main road's edge like an added lane, from nothing at the
 *   node to its full width alongside, then follows its own line.
 *
 * The OSM nodes stay where they are, only the drawing moves.
 */

/** A road leaving a node: along way `wayId` from point `index`, `step` +1 with the way, −1 against it. */
type Arm = { wayId: string; index: number; step: 1 | -1 };

/** How far along a road from the node it may be moved, metres. */
const REACH = 200;
/** Closer than this the two lines count as one and do not say which side the road is on. */
const SAME_LINE = 0.3;
/** Most a slip road may leave its main road at to be drawn alongside it, degrees. */
const LINK_ANGLE = 20;
/** A slip road has to run inside the main road at least this far to be moved out of it, metres. */
const LINK_OVERLAP = 10;
/** How far the light outline of a road reaches past its carriageway, metres. */
const OUTLINE = 0.6;
/** Most a road may turn at a node and still go on into the next one, degrees (as in section.ts). */
const MAX_BEND = 35;

const cosOf = (deg: number) => Math.cos((deg * Math.PI) / 180);

export interface DrawnRoads {
  /** Sideways shift of every point of a moved way, metres to the left of its direction. */
  readonly shifts: Map<string, number[]>;
  /** Tapers of every way: where it narrows into the next road, and where a slip road grows out of its main road. */
  readonly tapers: Map<string, Taper[]>;
  /** How much of the road is left out at each end, metres: [start, end]. */
  readonly trims: Map<string, [number, number]>;
}

const cache = new WeakMap<OsmDoc, DrawnRoads>();

/** How the roads of a document are drawn beyond their bare lines: tapers, shifts, trimmed ends. */
export function drawnRoads(doc: OsmDoc): DrawnRoads {
  const hit = cache.get(doc);
  if (hit) return hit;
  const tapers = new Map([...roadTapers(doc)].map(([id, list]) => [id, [...list]]));
  const shifts = new Map<string, number[]>();
  const trims = new Map<string, [number, number]>();
  const atNode = new Map<string, Arm[]>();
  for (const w of Object.values(doc.ways)) {
    if (!isDrivable(w.tags) || w.refs.length < 2 || w.refs.some((r) => !doc.nodes[r])) continue;
    const last = w.refs.length - 1;
    w.refs.forEach((r, index) => {
      const list = atNode.get(r) ?? [];
      if (index < last) list.push({ wayId: w.id, index, step: 1 });
      if (index > 0) list.push({ wayId: w.id, index, step: -1 });
      atNode.set(r, list);
    });
  }
  const tagsOf = (a: Arm) => doc.ways[a.wayId].tags;
  const sectionOfArm = (a: Arm) => sectionOf(tagsOf(a));
  const isEnd = (a: Arm) => a.index === 0 || a.index === doc.ways[a.wayId].refs.length - 1;
  const isService = (a: Arm) => tagsOf(a).highway === 'service';
  const isLink = (a: Arm) => /_link$/.test(tagsOf(a).highway ?? '');

  for (const [nodeId, arms] of atNode) {
    if (arms.length < 2) continue;
    const f = frame(doc.nodes[nodeId].lat);
    const lines = arms.map((a): V[] => {
      const refs = doc.ways[a.wayId].refs;
      const pts: V[] = [];
      for (let k = a.index; k >= 0 && k < refs.length; k += a.step) pts.push(f.to(doc.nodes[refs[k]].lon, doc.nodes[refs[k]].lat));
      return pts;
    });
    const dirs = lines.map(([a, b]): V | null => {
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      return l ? [(b[0] - a[0]) / l, (b[1] - a[1]) / l] : null;
    });
    const dot = (i: number, j: number) => (dirs[i] && dirs[j] ? dirs[i]![0] * dirs[j]![0] + dirs[i]![1] * dirs[j]![1] : -2);
    const rank = (a: Arm) => ({ minor: isMinor(tagsOf(a)), width: widthOf(sectionOfArm(a)) });
    /** > 0 when arm `a` is the greater road, 0 when they are equal. */
    const compare = (a: Arm, b: Arm) => {
      const [ra, rb] = [rank(a), rank(b)];
      if (ra.minor !== rb.minor) return ra.minor ? -1 : 1;
      return Math.abs(ra.width - rb.width) < 0.1 ? 0 : ra.width - rb.width;
    };
    /** Arms leaving side by side with arm `i`, of other ways. */
    const beside = (i: number, deg: number) => arms.map((_, j) => j).filter((j) => arms[j].wayId !== arms[i].wayId && !isService(arms[j]) && dot(i, j) >= cosOf(deg));
    /** Whether arm `i` is one of the roads a wider road forks into here. */
    const inFork = (i: number) => {
      const bundle = [i, ...beside(i, SIDE_BY_SIDE)];
      if (bundle.length < 2) return false;
      const width = bundle.reduce((s, j) => s + widthOf(sectionOfArm(arms[j])), 0);
      // Exactly its lanes: more would be roads merging into it, fewer a road that narrows.
      return arms.some((w, k) => isEnd(w) && !bundle.includes(k) && dot(i, k) <= -cosOf(MAX_BEND) && Math.abs(width - widthOf(sectionOfArm(w))) < 0.05);
    };

    arms.forEach((arm, i) => {
      // Yard driveways stay on their lines: they are drawn thin and meet roads anyhow.
      if (!dirs[i] || !isEnd(arm) || isService(arm)) return;
      const fork = inFork(i);
      const candidates = fork ? beside(i, SIDE_BY_SIDE) : isLink(arm) ? beside(i, LINK_ANGLE).filter((j) => !isMinor(tagsOf(arms[j]))) : [];
      if (!candidates.length) return;
      const j = candidates.reduce((best, x) => (compare(arms[x], arms[best]) > 0 ? x : best));
      const order = compare(arms[j], arm);
      if (order < 0) return;
      const share = order === 0 ? 0.5 : 1;
      const other = arms[j];
      const edges = edgesOf(sectionOfArm(other));
      const [otherLeft, otherRight] = other.step === 1 ? [edges.left, edges.right] : [edges.right, edges.left];
      const half = widthOf(sectionOfArm(arm)) / 2;
      const pts = lines[i];
      const run = cumulative(pts);
      const dists = pts.map((p) => signedDistance(lines[j], p));
      const first = dists.findIndex((d, k) => k > 0 && run[k] <= REACH && Math.abs(d) > SAME_LINE);
      const side = first > 0 ? Math.sign(dists[first]) : Math.sign(dirs[j]![0] * dirs[i]![1] - dirs[j]![1] * dirs[i]![0]) || 1;
      const edge = side > 0 ? otherLeft : otherRight;
      // A slip road grows out of the main road over the stretch it would run inside it.
      let grow = 0;
      if (!fork) {
        grow = overlapLength(pts, lines[j], side, edge + half);
        if (grow < LINK_OVERLAP) return;
        const way = doc.ways[arm.wayId];
        const atStart = arm.index === 0;
        const list = tapers.get(way.id) ?? [];
        if (list.some((t) => t.atStart === atStart)) return;
        const total = cumulative(lines[i]).at(-1)!;
        const length = Math.min(grow, 0.45 * total);
        const nothing: Section = { forward: 0, backward: 0, lane: sectionOfArm(arm).lane };
        tapers.set(way.id, [...list, { atStart, length, to: nothing, shift: half }]);
        grow = length;
      }
      const way = doc.ways[arm.wayId];
      const offs = shifts.get(way.id) ?? new Array<number>(way.refs.length).fill(0);
      let moved = false;
      for (let k = 0; k < pts.length && run[k] <= REACH; k += 1) {
        // Width grows from nothing at the node over `grow` metres (smoothstep, as tapers do).
        const t = grow > 0 ? Math.min(1, run[k] / grow) : 1;
        const needed = edge + half * (t * t * (3 - 2 * t));
        const push = Math.max(0, needed - Math.max(0, side * dists[k])) * share;
        if (push <= 0.01) {
          if (k > 0) break;
          continue;
        }
        const value = side * push * arm.step;
        const at = arm.index + k * arm.step;
        if (Math.abs(value) > Math.abs(offs[at])) offs[at] = value;
        moved = true;
      }
      if (moved) shifts.set(way.id, offs);
    });

    // A road that ends on a narrower one crossing it (a T junction) would show its round end
    // beyond the far edge: it stops short so the end stays on the road it meets.
    arms.forEach((arm, i) => {
      if (!dirs[i] || !isEnd(arm)) return;
      if (arms.some((_, k) => k !== i && dot(i, k) <= -cosOf(MAX_BEND))) return;
      const half = widthOf(sectionOfArm(arm)) / 2;
      let best = Infinity;
      arms.forEach((o, k) => {
        if (o.wayId === arm.wayId || !dirs[k]) return;
        const sin = Math.abs(dirs[i]![0] * dirs[k]![1] - dirs[i]![1] * dirs[k]![0]);
        // Only a road that goes on across, both ways from the node, and meets this one well apart from straight on.
        const across = arms.some((b, l) => l !== k && l !== i && b.wayId !== arm.wayId && dot(k, l) <= -cosOf(MAX_BEND));
        if (!across || sin < 0.5) return;
        // The outline drawn round the road reaches a little further than the carriageway.
        const over = half - widthOf(sectionOfArm(o)) / 2;
        best = Math.min(best, over > 0 ? (over + OUTLINE) / sin : 0);
      });
      if (!Number.isFinite(best) || best < 0.05) return;
      const way = doc.ways[arm.wayId];
      const total = cumulative(lines[i]).at(-1)!;
      const cut = Math.min(best, total * 0.3);
      const t = trims.get(way.id) ?? [0, 0];
      t[arm.index === 0 ? 0 : 1] = cut;
      trims.set(way.id, t);
    });
  }
  const out = { shifts, tapers, trims };
  cache.set(doc, out);
  return out;
}

/** Sideways shifts of the moved ways (see drawnRoads). */
export const roadShifts = (doc: OsmDoc) => drawnRoads(doc).shifts;

function cumulative(pts: readonly V[]): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i += 1) out.push(out[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return out;
}

/** How far from the node a road on `side` of `ref` stays closer to it than `needed`, metres, in 1 m steps. */
function overlapLength(pts: readonly V[], ref: readonly V[], side: number, needed: number): number {
  let d = 0;
  for (let i = 0; i + 1 < pts.length && d < REACH; i += 1) {
    const [a, b] = [pts[i], pts[i + 1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let s = 0; s < len; s += 1) {
      const p: V = [a[0] + ((b[0] - a[0]) * s) / len, a[1] + ((b[1] - a[1]) * s) / len];
      if (Math.max(0, side * signedDistance(ref, p)) >= needed) return d + s;
    }
    d += len;
  }
  return d;
}

/** Distance of `p` from the polyline, positive to its left. */
export function signedDistance(line: readonly V[], p: V): number {
  let best = Infinity;
  let sign = 1;
  for (let i = 0; i + 1 < line.length; i += 1) {
    const [a, b] = [line[i], line[i + 1]];
    const d: V = [b[0] - a[0], b[1] - a[1]];
    const len2 = d[0] * d[0] + d[1] * d[1] || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / len2));
    const q: V = [a[0] + d[0] * t, a[1] + d[1] * t];
    const dist = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (dist < best) {
      best = dist;
      sign = d[0] * (p[1] - a[1]) - d[1] * (p[0] - a[0]) >= 0 ? 1 : -1;
    }
  }
  return line.length < 2 ? 0 : best * sign;
}

/** Points of a way in a local frame (y north), moved sideways where the way is shifted. */
export function wayPoints(doc: OsmDoc, w: OsmWay, f: ReturnType<typeof frame>): V[] {
  const pts = w.refs.filter((r) => doc.nodes[r]).map((r) => f.to(doc.nodes[r].lon, doc.nodes[r].lat));
  const offs = roadShifts(doc).get(w.id);
  return offs && offs.length === pts.length ? offsetLine(pts, offs) : pts;
}
