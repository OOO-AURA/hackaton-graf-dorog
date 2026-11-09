import { addNode, createWay, insertNodeInWay } from './edit';
import { projectOnSegment, projector } from './geo';
import type { OsmDoc, Tags } from './types';

export interface DrawPoint {
  readonly lon: number;
  readonly lat: number;
  readonly nodeId?: string;
  readonly wayId?: string;
}

/** Segment of `wayId` closest to the point, computed on the current document (indices shift after inserts). */
function nearestSegment(doc: OsmDoc, wayId: string, lon: number, lat: number): number {
  const way = doc.ways[wayId];
  const project = projector(lat);
  const p = project([lon, lat]);
  let best = 0;
  let bestDist = Infinity;
  way.refs.slice(1).forEach((r, i) => {
    const a = doc.nodes[way.refs[i]];
    const b = doc.nodes[r];
    const { dist2 } = projectOnSegment(p, project([a.lon, a.lat]), project([b.lon, b.lat]));
    if (dist2 < bestDist) { bestDist = dist2; best = i; }
  });
  return best;
}

function resolvePoint(doc: OsmDoc, point: DrawPoint): { doc: OsmDoc; id: string } {
  if (point.nodeId && doc.nodes[point.nodeId]) return { doc, id: point.nodeId };
  if (point.wayId && doc.ways[point.wayId]) {
    return insertNodeInWay(doc, point.wayId, nearestSegment(doc, point.wayId, point.lon, point.lat), point.lon, point.lat);
  }
  return addNode(doc, point.lon, point.lat);
}

/**
 * Builds a new road from drawn points in one step: existing nodes are reused, points on roads
 * become shared intersection nodes, free points become new nodes.
 */
export function commitDrawing(doc: OsmDoc, points: readonly DrawPoint[], tags: Tags): { doc: OsmDoc; wayId: string } {
  if (points.length < 2) return { doc, wayId: '' };
  const { doc: withNodes, refs } = points.reduce(
    (acc, point) => {
      const resolved = resolvePoint(acc.doc, point);
      return { doc: resolved.doc, refs: [...acc.refs, resolved.id] };
    },
    { doc, refs: [] as string[] },
  );
  const deduped = refs.filter((r, i) => i === 0 || refs[i - 1] !== r);
  if (deduped.length < 2) return { doc, wayId: '' };
  const created = createWay(withNodes, deduped, tags);
  return { doc: created.doc, wayId: created.id };
}
