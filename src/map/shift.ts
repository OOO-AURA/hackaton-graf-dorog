import { isDrivable } from '../osm/tags';
import type { OsmDoc, OsmWay } from '../osm/types';
import { frame, offsetLine, type V } from './polyline';
import { edgesOf, isMinor, sectionOf, SIDE_BY_SIDE, widthOf } from './section';

/**
 * Roads that leave a node side by side, like slip roads at the end of a bridge or the two halves
 * of a dual carriageway where it splits, are often mapped with lines closer together than their
 * widths: drawn on those lines they lie on top of each other for the first tens of metres. Here
 * the lesser road is moved sideways just enough to run alongside the greater one, from the node
 * until its own line has drawn away; two equal roads each move half the way. The OSM nodes stay
 * where they are, only the drawing moves.
 */

/** A road leaving a node: along way `wayId` from point `index`, `step` +1 with the way, −1 against it. */
type Arm = { wayId: string; index: number; step: 1 | -1 };

/** How far along a road from the node it may be moved, metres. */
const REACH = 200;
/** Closer than this the two lines count as one and do not say which side the road is on. */
const SAME_LINE = 0.3;

const cache = new WeakMap<OsmDoc, Map<string, number[]>>();

/**
 * Sideways shift of every point of the ways that are moved, metres to the left of the way's
 * direction; ways that stay on their line are not in the map.
 */
export function roadShifts(doc: OsmDoc): Map<string, number[]> {
  const hit = cache.get(doc);
  if (hit) return hit;
  const out = new Map<string, number[]>();
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
  const cos = Math.cos((SIDE_BY_SIDE * Math.PI) / 180);
  for (const [nodeId, arms] of atNode) {
    if (arms.length < 2) continue;
    const f = frame(doc.nodes[nodeId].lat);
    /** Points of an arm from the node on, in local metres. */
    const line = (a: Arm): V[] => {
      const refs = doc.ways[a.wayId].refs;
      const pts: V[] = [];
      for (let k = a.index; k >= 0 && k < refs.length; k += a.step) {
        const n = doc.nodes[refs[k]];
        pts.push(f.to(n.lon, n.lat));
      }
      return pts;
    };
    const lines = arms.map(line);
    const dirs = lines.map(([a, b]) => {
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      return l ? [(b[0] - a[0]) / l, (b[1] - a[1]) / l] : null;
    });
    const rank = (a: Arm) => {
      const tags = doc.ways[a.wayId].tags;
      return { minor: isMinor(tags), width: widthOf(sectionOf(tags)) };
    };
    /** > 0 when arm `a` is the greater road, 0 when they are equal. */
    const compare = (a: Arm, b: Arm) => {
      const [ra, rb] = [rank(a), rank(b)];
      if (ra.minor !== rb.minor) return ra.minor ? -1 : 1;
      return Math.abs(ra.width - rb.width) < 0.1 ? 0 : ra.width - rb.width;
    };
    arms.forEach((arm, i) => {
      if (!dirs[i]) return;
      const near = arms
        .map((a, j) => ({ a, j }))
        .filter(({ a, j }) => a.wayId !== arm.wayId && dirs[j] && dirs[j]![0] * dirs[i]![0] + dirs[j]![1] * dirs[i]![1] >= cos);
      if (!near.length) return;
      const { a: other, j } = near.reduce((best, x) => (compare(x.a, best.a) > 0 ? x : best));
      const order = compare(other, arm);
      if (order < 0) return;
      const share = order === 0 ? 0.5 : 1;
      const pts = lines[i];
      const ref = lines[j];
      const otherTags = doc.ways[other.wayId].tags;
      const edges = edgesOf(sectionOf(otherTags));
      // Edges of the other road on its left and right as it leaves the node.
      const [otherLeft, otherRight] = other.step === 1 ? [edges.left, edges.right] : [edges.right, edges.left];
      const half = widthOf(sectionOf(doc.ways[arm.wayId].tags)) / 2;
      const dists = pts.map((p) => signedDistance(ref, p));
      const run = cumulative(pts);
      const first = dists.findIndex((d, k) => k > 0 && run[k] <= REACH && Math.abs(d) > SAME_LINE);
      const side = first > 0 ? Math.sign(dists[first]) : Math.sign(dirs[j]![0] * dirs[i]![1] - dirs[j]![1] * dirs[i]![0]) || 1;
      const needed = half + (side > 0 ? otherLeft : otherRight);
      const way = doc.ways[arm.wayId];
      const offs = out.get(way.id) ?? new Array<number>(way.refs.length).fill(0);
      let moved = false;
      for (let k = 0; k < pts.length && run[k] <= REACH; k += 1) {
        const push = Math.max(0, needed - Math.max(0, side * dists[k])) * share;
        if (push <= 0.01) {
          if (k > 0) break;
          continue;
        }
        // Left of the arm is left of the way when the arm runs with it.
        const value = side * push * arm.step;
        const at = arm.index + k * arm.step;
        if (Math.abs(value) > Math.abs(offs[at])) offs[at] = value;
        moved = true;
      }
      if (moved) out.set(way.id, offs);
    });
  }
  cache.set(doc, out);
  return out;
}

function cumulative(pts: readonly V[]): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i += 1) out.push(out[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return out;
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
