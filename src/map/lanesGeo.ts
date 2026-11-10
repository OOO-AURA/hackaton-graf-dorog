import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import { armKey, armsAt, junctionLanes, junctions, type Arm } from '../osm/lanes';
import { isDrivable } from '../osm/tags';
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

/** How far from the centre of a junction its lanes end. */
function junctionRadius(doc: OsmDoc, nodeId: string): number {
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
export function laneLines(doc: OsmDoc, style: LaneStyle): FeatureCollection<LineString, Props> {
  const radius = new Map(junctions(doc).map((id) => [id, junctionRadius(doc, id)]));
  const tapers = roadTapers(doc);
  const features: Feature<LineString, Props>[] = [];
  for (const w of Object.values(doc.ways)) {
    if (!isDrivable(w.tags) || w.refs.length < 2) continue;
    const nodes = w.refs.map((r) => doc.nodes[r]);
    if (nodes.some((n) => !n)) continue;
    const vc = style.load(w.id);
    const raised = Boolean((w.tags.bridge && w.tags.bridge !== 'no') || (w.tags.tunnel && w.tags.tunnel !== 'no'));
    const base = sectionOf(w.tags);
    const wayTapers = tapers.get(w.id);
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
      const geometry = (offs: number[]) => ({ type: 'LineString' as const, coordinates: offsetLine(line, offs).map(f.back) });
      for (const lane of sections[0].lanes) {
        const offs = sections.map((sec) => sec.lanes.find((l) => l.travel === lane.travel && l.index === lane.index)!.offset);
        features.push({ type: 'Feature', properties: { way: w.id, kind: 'lane', color: style.color(vc), loaded: vc !== null, raised }, geometry: geometry(offs) });
      }
      // A marking runs while it is in the cross-section: the ones between merging lanes stop at the taper.
      const keys = new Set(sections.flatMap((sec) => sec.dividers.map((m) => m.key)));
      for (const key of keys) {
        let run: number[] = [];
        let solid = false;
        const flush = () => {
          if (run.length >= 2) {
            const sub = run.map((i) => line[i]);
            const offs = run.map((i) => sections[i].dividers.find((m) => m.key === key)!.offset);
            features.push({ type: 'Feature', properties: { way: w.id, kind: 'divider', solid, raised }, geometry: { type: 'LineString', coordinates: offsetLine(sub, offs).map(f.back) } });
          }
          run = [];
        };
        sections.forEach((sec, i) => {
          const m = sec.dividers.find((x) => x.key === key);
          if (m) { run.push(i); solid = m.solid; } else flush();
        });
        flush();
      }
    });
  }
  return { type: 'FeatureCollection', features };
}

/** Where the lane `index` of an arm meets the edge of the junction, and the arm's outward direction. */
function laneEnd(doc: OsmDoc, arm: Arm, coming: boolean, index: number, r: number, f: ReturnType<typeof frame>): { p: V; out: V } {
  const way = doc.ways[arm.wayId];
  const refs = arm.step === 1 ? way.refs.slice(arm.index) : way.refs.slice(0, arm.index + 1).reverse();
  const pts = refs.map((id) => doc.nodes[id]).filter(Boolean).map((n) => f.to(n.lon, n.lat));
  const { p, t } = along(pts, Math.min(r, lengthOf(pts) * 0.45));
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

/**
 * Lane ends and lane-to-lane links at junctions. Links are drawn at every junction given;
 * the ends only at `withEnds`, the junction being edited.
 */
export function junctionGeometry(doc: OsmDoc, nodeIds: readonly string[], withEnds: string | null, style: LaneStyle) {
  const ends: Feature<Point, Props>[] = [];
  const links: Feature<LineString, Props>[] = [];
  for (const nodeId of nodeIds) {
    const node = doc.nodes[nodeId];
    if (!node) continue;
    const f = frame(node.lat);
    const r = junctionRadius(doc, nodeId) - (JUNCTION_MARGIN - 0.5);
    const lanes = junctionLanes(doc, nodeId);
    const endOf = (arm: Arm, coming: boolean, i: number) => laneEnd(doc, arm, coming, i, r, f);
    lanes.links.forEach((l) => {
      const a = endOf(l.from, true, l.fromLane);
      const b = endOf(l.to, false, l.toLane);
      links.push({
        type: 'Feature',
        properties: { node: nodeId, from: armKey(l.from), lane: l.fromLane, to: armKey(l.to), turn: l.turn, color: style.color(style.load(l.from.wayId)), edit: nodeId === withEnds },
        geometry: { type: 'LineString', coordinates: curve(a, b).map(f.back) },
      });
    });
    if (nodeId !== withEnds) continue;
    for (const arm of lanes.arms) {
      for (let i = 0; i < arm.lanesIn; i += 1) {
        ends.push({ type: 'Feature', properties: { node: nodeId, arm: armKey(arm), lane: i, kind: 'in' }, geometry: { type: 'Point', coordinates: f.back(endOf(arm, true, i).p) } });
      }
      for (let i = 0; i < arm.lanesOut; i += 1) {
        ends.push({ type: 'Feature', properties: { node: nodeId, arm: armKey(arm), lane: i, kind: 'out' }, geometry: { type: 'Point', coordinates: f.back(endOf(arm, false, i).p) } });
      }
    }
  }
  return {
    ends: { type: 'FeatureCollection', features: ends } as FeatureCollection<Point, Props>,
    links: { type: 'FeatureCollection', features: links } as FeatureCollection<LineString, Props>,
  };
}
