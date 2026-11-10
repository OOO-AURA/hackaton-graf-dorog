/**
 * What changed between the file as it was opened and the current graph: for the changes layer on
 * the map and a change list the team can show the jury ("what we fixed and where").
 * Unchanged objects are shared by reference between versions, so the diff is cheap.
 */
import type { OsmDoc, OsmNode, OsmRelation, OsmWay, Tags } from './types';

export type ChangeKind = 'added' | 'deleted' | 'geometry' | 'tags';
export type TagChange = readonly [key: string, before: string | null, after: string | null];

export interface WayChange { readonly id: string; readonly kind: ChangeKind; readonly tags: readonly TagChange[]; readonly name: string }
export interface NodeChange { readonly id: string; readonly kind: ChangeKind | 'moved'; readonly tags: readonly TagChange[] }

export interface DocDiff {
  readonly ways: readonly WayChange[];
  readonly nodes: readonly NodeChange[];
  readonly relationsAdded: number;
  readonly relationsDeleted: number;
  readonly relationsChanged: number;
}

export function tagChanges(before: Tags, after: Tags): TagChange[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return keys.filter((k) => before[k] !== after[k]).map((k) => [k, before[k] ?? null, after[k] ?? null] as const);
}

const sameRefs = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((r, i) => r === b[i]);

/** By value, so two separately opened files compare correctly too. */
const sameRelation = (a: OsmRelation, b: OsmRelation) => a === b || (
  tagChanges(a.tags, b.tags).length === 0
  && a.members.length === b.members.length
  && a.members.every((m, i) => m.type === b.members[i].type && m.ref === b.members[i].ref && m.role === b.members[i].role));

function wayChange(id: string, before: OsmWay | undefined, after: OsmWay | undefined): WayChange | null {
  if (before === after) return null;
  const name = (after ?? before)?.tags.name ?? '';
  if (!before) return { id, kind: 'added', tags: tagChanges({}, after!.tags), name };
  if (!after) return { id, kind: 'deleted', tags: [], name };
  const tags = tagChanges(before.tags, after.tags);
  if (!sameRefs(before.refs, after.refs)) return { id, kind: 'geometry', tags, name };
  return tags.length ? { id, kind: 'tags', tags, name } : null;
}

/** Plain vertices are reported only when tagged or untagged; moved shape points show up as way geometry. */
function nodeChange(id: string, before: OsmNode | undefined, after: OsmNode | undefined): NodeChange | null {
  if (before === after) return null;
  if (!before) return Object.keys(after!.tags).length ? { id, kind: 'added', tags: tagChanges({}, after!.tags) } : null;
  if (!after) return Object.keys(before.tags).length ? { id, kind: 'deleted', tags: tagChanges(before.tags, {}) } : null;
  const tags = tagChanges(before.tags, after.tags);
  if (tags.length) return { id, kind: 'tags', tags };
  return before.lat !== after.lat || before.lon !== after.lon ? { id, kind: 'moved', tags: [] } : null;
}

export function docDiff(base: OsmDoc, current: OsmDoc): DocDiff {
  const ids = <T>(a: Record<string, T>, b: Record<string, T>) => [...new Set([...Object.keys(a), ...Object.keys(b)])];
  const ways = ids(base.ways, current.ways).map((id) => wayChange(id, base.ways[id], current.ways[id])).filter((c): c is WayChange => c !== null);
  const nodes = ids(base.nodes, current.nodes).map((id) => nodeChange(id, base.nodes[id], current.nodes[id])).filter((c): c is NodeChange => c !== null);
  const relIds = ids(base.relations, current.relations);
  return {
    ways, nodes,
    relationsAdded: relIds.filter((id) => !base.relations[id] && current.relations[id]).length,
    relationsDeleted: relIds.filter((id) => base.relations[id] && !current.relations[id]).length,
    relationsChanged: relIds.filter((id) => base.relations[id] && current.relations[id] && !sameRelation(base.relations[id], current.relations[id])).length,
  };
}

export const isEmptyDiff = (d: DocDiff) => !d.ways.length && !d.nodes.length && !d.relationsAdded && !d.relationsDeleted && !d.relationsChanged;

const KIND_TEXT: Readonly<Record<NodeChange['kind'], string>> = { added: 'добавлено', deleted: 'удалено', geometry: 'изменена геометрия', tags: 'изменены атрибуты', moved: 'перемещён' };

const tagText = (t: TagChange) => `\`${t[0]}\`: ${t[1] ?? '—'} → ${t[2] ?? '—'}`;

/** Markdown list of every change, grouped by kind, for the defence or the repository. */
export function diffMarkdown(diff: DocDiff, base: OsmDoc, current: OsmDoc, fileName: string): string {
  const lines = [`# Изменения графа: ${fileName}`, ''];
  lines.push(`Линий: ${diff.ways.length}, узлов с атрибутами: ${diff.nodes.length}, отношений: +${diff.relationsAdded} / −${diff.relationsDeleted} / изменено ${diff.relationsChanged}.`, '');
  const label = (w: WayChange) => {
    const t = (current.ways[w.id] ?? base.ways[w.id])?.tags ?? {};
    return `${w.name || t.highway || t.building && 'здание' || t.railway || 'линия'} (way ${w.id})`;
  };
  (['added', 'deleted', 'geometry', 'tags'] as const).forEach((kind) => {
    const group = diff.ways.filter((w) => w.kind === kind);
    if (!group.length) return;
    lines.push(`## Линии: ${KIND_TEXT[kind]} (${group.length})`, '');
    group.forEach((w) => lines.push(`- ${label(w)}${w.tags.length ? `: ${w.tags.map(tagText).join('; ')}` : ''}`));
    lines.push('');
  });
  if (diff.nodes.length) {
    lines.push(`## Узлы (${diff.nodes.length})`, '');
    diff.nodes.forEach((n) => lines.push(`- node ${n.id}, ${KIND_TEXT[n.kind]}${n.tags.length ? `: ${n.tags.map(tagText).join('; ')}` : ''}`));
    lines.push('');
  }
  return lines.join('\n');
}

/** Map features: changed and new ways on the current graph, deleted ways from the opened file, tagged nodes. */
export function diffFeatures(diff: DocDiff, base: OsmDoc, current: OsmDoc): unknown[] {
  const line = (doc: OsmDoc, id: string, kind: string) => {
    const w = doc.ways[id];
    const coordinates = w ? w.refs.filter((r) => doc.nodes[r]).map((r) => [doc.nodes[r].lon, doc.nodes[r].lat]) : [];
    return coordinates.length > 1 ? [{ type: 'Feature', properties: { kind, id }, geometry: { type: 'LineString', coordinates } }] : [];
  };
  const point = (doc: OsmDoc, id: string, kind: string) => {
    const n = doc.nodes[id];
    return n ? [{ type: 'Feature', properties: { kind, id }, geometry: { type: 'Point', coordinates: [n.lon, n.lat] } }] : [];
  };
  return [
    ...diff.ways.flatMap((w) => (w.kind === 'deleted' ? line(base, w.id, 'deleted') : line(current, w.id, w.kind))),
    ...diff.nodes.filter((n) => n.kind !== 'moved').flatMap((n) => (n.kind === 'deleted' ? point(base, n.id, 'deleted') : point(current, n.id, n.kind))),
  ];
}
