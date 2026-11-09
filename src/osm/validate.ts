import { largestGroup, strongComponents, weakComponents } from './components';
import { haversine, projector, segmentIntersection, type LonLat } from './geo';
import { directedArcs, drivableWays } from './roads';
import type { OsmDoc, OsmWay } from './types';

export type IssueKind = 'isolated' | 'trap' | 'crossing' | 'near-nodes';

export type IssueFix =
  | { type: 'connect'; a: { wayId: string; index: number }; b: { wayId: string; index: number }; at: LonLat }
  | { type: 'merge'; keep: string; remove: string };

export interface Issue {
  readonly id: string;
  readonly kind: IssueKind;
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly at: LonLat;
  readonly wayIds: readonly string[];
  readonly nodeIds: readonly string[];
  readonly fix?: IssueFix;
}

export interface ValidationReport {
  readonly issues: readonly Issue[];
  readonly stats: { ways: number; nodes: number; signals: number; lengthKm: number; components: number };
}

/** Two nodes closer than this but not connected look like a broken intersection. */
const NEAR_NODE_M = 3;
const GRID_M = 25;

const layerOf = (w: OsmWay) => {
  const layer = Number.parseInt(w.tags.layer ?? '0', 10) || 0;
  return w.tags.bridge && w.tags.bridge !== 'no' ? Math.max(layer, 1) : w.tags.tunnel && w.tags.tunnel !== 'no' ? Math.min(layer, -1) : layer;
};

const lonLat = (doc: OsmDoc, id: string): LonLat => [doc.nodes[id].lon, doc.nodes[id].lat];

function connectivityIssues(doc: OsmDoc, ways: OsmWay[], nodes: string[]): { issues: Issue[]; components: number } {
  const arcs = directedArcs(ways);
  const weak = weakComponents(nodes, arcs);
  const mainWeak = largestGroup(weak);
  const strong = strongComponents(nodes, arcs);
  const mainStrong = largestGroup(strong);
  const issues: Issue[] = [];
  const reported = new Set<string>();

  ways.forEach((w) => {
    const isolated = weak.get(w.refs[0]) !== mainWeak;
    const trapped = !isolated && w.refs.some((r) => strong.get(r) !== mainStrong);
    if (!isolated && !trapped) return;
    const key = isolated ? `isolated:${weak.get(w.refs[0])}` : `trap:${w.id}`;
    if (reported.has(key)) return;
    reported.add(key);
    const groupWays = isolated ? ways.filter((o) => weak.get(o.refs[0]) === weak.get(w.refs[0])).map((o) => o.id) : [w.id];
    issues.push({
      id: key,
      kind: isolated ? 'isolated' : 'trap',
      severity: isolated ? 'error' : 'warning',
      message: isolated
        ? `Изолированный участок сети (${groupWays.length} дор.) — не связан с основным графом`
        : 'Тупик по направлению: отсюда нельзя вернуться в основную сеть (проверьте oneway)',
      at: lonLat(doc, w.refs[Math.floor(w.refs.length / 2)]),
      wayIds: groupWays,
      nodeIds: [],
    });
  });
  return { issues, components: new Set(weak.values()).size };
}

interface Segment { wayId: string; index: number; layer: number; a: string; b: string; pa: [number, number]; pb: [number, number] }

function buildSegments(doc: OsmDoc, ways: OsmWay[], project: (p: LonLat) => [number, number]): Segment[] {
  return ways.flatMap((w) => w.refs.slice(1).map((b, i) => ({
    wayId: w.id, index: i, layer: layerOf(w), a: w.refs[i], b,
    pa: project(lonLat(doc, w.refs[i])), pb: project(lonLat(doc, b)),
  })));
}

function gridBuckets<T>(items: T[], cells: (item: T) => string[]): Map<string, T[]> {
  const grid = new Map<string, T[]>();
  items.forEach((it) => cells(it).forEach((c) => grid.set(c, [...(grid.get(c) ?? []), it])));
  return grid;
}

function segmentCells(s: Segment): string[] {
  const [x0, x1] = [Math.min(s.pa[0], s.pb[0]), Math.max(s.pa[0], s.pb[0])].map((v) => Math.floor(v / GRID_M));
  const [y0, y1] = [Math.min(s.pa[1], s.pb[1]), Math.max(s.pa[1], s.pb[1])].map((v) => Math.floor(v / GRID_M));
  const cells: string[] = [];
  for (let x = x0; x <= x1; x += 1) for (let y = y0; y <= y1; y += 1) cells.push(`${x}:${y}`);
  return cells;
}

function crossingIssues(doc: OsmDoc, segments: Segment[]): Issue[] {
  const issues = new Map<string, Issue>();
  gridBuckets(segments, segmentCells).forEach((bucket) => {
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const s = bucket[i];
        const o = bucket[j];
        if (s.wayId === o.wayId || s.layer !== o.layer) continue;
        if ([s.a, s.b].some((n) => n === o.a || n === o.b)) continue;
        const hit = segmentIntersection(s.pa, s.pb, o.pa, o.pb);
        if (!hit) continue;
        const key = `crossing:${[`${s.wayId}/${s.index}`, `${o.wayId}/${o.index}`].sort().join('|')}`;
        const [aLon, aLat] = lonLat(doc, s.a);
        const [bLon, bLat] = lonLat(doc, s.b);
        const at: LonLat = [aLon + (bLon - aLon) * hit.t, aLat + (bLat - aLat) * hit.t];
        issues.set(key, {
          id: key, kind: 'crossing', severity: 'error',
          message: 'Дороги пересекаются без общего узла (разорванный перекрёсток или нужен bridge/layer)',
          at, wayIds: [s.wayId, o.wayId], nodeIds: [],
          fix: { type: 'connect', a: { wayId: s.wayId, index: s.index }, b: { wayId: o.wayId, index: o.index }, at },
        });
      }
    }
  });
  return [...issues.values()];
}

function nearNodeIssues(doc: OsmDoc, ways: OsmWay[], project: (p: LonLat) => [number, number]): Issue[] {
  const neighbours = new Map<string, Set<string>>();
  ways.forEach((w) => w.refs.forEach((r, i) => {
    const set = neighbours.get(r) ?? new Set<string>();
    if (i > 0) set.add(w.refs[i - 1]);
    if (i < w.refs.length - 1) set.add(w.refs[i + 1]);
    neighbours.set(r, set);
  }));
  const ids = [...neighbours.keys()];
  const cell = (id: string) => project(lonLat(doc, id)).map((v) => Math.floor(v / NEAR_NODE_M));
  const grid = gridBuckets(ids, (id) => [cell(id).join(':')]);
  const issues: Issue[] = [];
  ids.forEach((id) => {
    const [cx, cy] = cell(id);
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) {
      (grid.get(`${cx + dx}:${cy + dy}`) ?? []).forEach((other) => {
        if (other <= id || neighbours.get(id)!.has(other)) return;
        if (haversine(lonLat(doc, id), lonLat(doc, other)) > NEAR_NODE_M) return;
        issues.push({
          id: `near:${id}|${other}`, kind: 'near-nodes', severity: 'warning',
          message: 'Два узла почти совпадают, но не соединены (разорванный перекрёсток)',
          at: lonLat(doc, id), wayIds: [], nodeIds: [id, other],
          fix: { type: 'merge', keep: id, remove: other },
        });
      });
    }
  });
  return issues;
}

/** Checks the road graph for errors typical of OSM that break MatSim/SUMO simulations. */
export function validate(doc: OsmDoc): ValidationReport {
  const ways = drivableWays(doc);
  const nodes = [...new Set(ways.flatMap((w) => w.refs))];
  const project = projector(ways.length ? doc.nodes[ways[0].refs[0]].lat : 0);
  const connectivity = connectivityIssues(doc, ways, nodes);
  const issues = [
    ...connectivity.issues,
    ...crossingIssues(doc, buildSegments(doc, ways, project)),
    ...nearNodeIssues(doc, ways, project),
  ];
  const lengthM = ways.reduce((sum, w) => sum + w.refs.slice(1).reduce((s, r, i) => s + haversine(lonLat(doc, w.refs[i]), lonLat(doc, r)), 0), 0);
  return {
    issues,
    stats: {
      ways: ways.length,
      nodes: nodes.length,
      signals: nodes.filter((n) => doc.nodes[n].tags.highway === 'traffic_signals').length,
      lengthKm: lengthM / 1000,
      components: connectivity.components,
    },
  };
}
