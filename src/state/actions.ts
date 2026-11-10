import { hasRepairs, OsmParseError, parseOsmChecked, type OsmRepairs } from '../osm/parse';
import { serializeOsm } from '../osm/serialize';
import { commitDrawing } from '../osm/draw';
import { deleteNode, deleteWay, flipDirection, reverseWay, splitWay, toggleSignal, waysOfNode } from '../osm/edit';
import { ROAD_TEMPLATES } from '../osm/tags';
import { buildingConflicts, cutBuildings, demolishBuildings, type BuildingConflict } from '../osm/clearance';
import { isRailLine } from '../osm/rail';
import { roadWidthMetres } from '../map/lanesGeo';
import type { DrawPoint } from '../osm/draw';
import type { OsmDoc, Tags } from '../osm/types';
import { addAllCordonConnectors } from '../osm/cordon';
import { currentSelection, useEditor } from './store';
import { refreshReport } from './validation';
import { askUser, baseName, downloadText, isDesktop, openOsmFile, saveOsmFile } from '../platform';

export function loadXml(xml: string, fileName: string, filePath: string | null = null): void {
  const { load, notify } = useEditor.getState();
  try {
    const { doc, repairs } = parseOsmChecked(xml);
    load(doc, fileName, filePath);
    const loaded = `Загружено: ${Object.keys(doc.nodes).length} узлов, ${Object.keys(doc.ways).length} линий`;
    notify(hasRepairs(repairs) ? `${loaded}. ${repairText(repairs)}` : loaded);
  } catch (err) {
    notify(err instanceof OsmParseError ? err.message : 'Не удалось прочитать файл');
    console.error('OSM load failed', err);
  }
}

/** Short note on what was dropped while opening a damaged or clipped file. */
export function repairText(r: OsmRepairs): string {
  const parts: string[] = [];
  if (r.badNodes) parts.push(`узлов без координат: ${r.badNodes}`);
  if (r.danglingRefs) parts.push(`ссылок на отсутствующие узлы: ${r.danglingRefs}`);
  if (r.droppedWays) parts.push(`линий, от которых осталось меньше двух узлов: ${r.droppedWays}`);
  return `Часть данных в файле неполная, при открытии убрано: ${parts.join(', ')}`;
}

export async function loadExample(): Promise<void> {
  try {
    const res = await fetch('./example.osm');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    loadXml(await res.text(), 'example.osm');
  } catch (err) {
    useEditor.getState().notify('Не удалось загрузить пример');
    console.error('Example load failed', err);
  }
}

export const BROWSER_FILE_INPUT = 'osm-file-input';

/** Opens a file: native dialog in the desktop app, hidden file input in the browser. */
export async function openFile(): Promise<void> {
  if (!isDesktop) { document.getElementById(BROWSER_FILE_INPUT)?.click(); return; }
  try {
    const file = await openOsmFile();
    if (file) loadXml(file.text, file.name, file.path);
  } catch (err) {
    useEditor.getState().notify(String(err));
    console.error('Open failed', err);
  }
}

/** Checks connectivity before saving, as the brief requires; the user may still save with warnings. */
export async function saveOsm(saveAs = false): Promise<void> {
  const s = useEditor.getState();
  if (!Object.keys(s.doc.nodes).length) return;
  const fileName = s.saveName.trim() || 'graph.osm';
  const report = await refreshReport();
  const errors = report.issues.filter((i) => i.severity === 'error').length;
  if (errors > 0 && !(await askUser(`Проверка нашла ошибок: ${errors}. Они видны на панели «Проверка». Сохранить всё равно?`))) return;
  const name = fileName.endsWith('.osm') ? fileName : `${fileName}.osm`;
  const text = serializeOsm(s.doc);
  if (!isDesktop) {
    downloadText(text, name);
    useEditor.setState({ savedDoc: s.doc });
    s.notify(`Сохранено ${name}`);
    return;
  }
  try {
    // Save over the opened file only when the name was not changed; otherwise ask where to put the new one.
    const reuse = !saveAs && s.filePath && baseName(s.filePath) === name ? s.filePath : null;
    const path = await saveOsmFile(text, name, reuse);
    if (!path) return;
    s.markSaved(baseName(path), path, s.doc);
    s.notify(`Сохранено ${path}`);
  } catch (err) {
    s.notify(String(err));
    console.error('Save failed', err);
  }
}

/** Width a new track takes, metres: a single track and its ballast. */
const TRACK_WIDTH = 4;

/** Width of what the template draws: the carriageway of a road, a track for a railway. */
export const drawWidth = (tags: Tags) => (isRailLine(tags) ? TRACK_WIDTH : roadWidthMetres(tags));

/** Buildings the road being drawn runs into, for the points drawn so far. */
export const drawingConflicts = (doc: OsmDoc, points: readonly DrawPoint[], tags: Tags): BuildingConflict[] =>
  buildingConflicts(doc, points, drawWidth(tags));

/** What to do with buildings in the way: cut them along the road, demolish them, or build over them. */
export type Clearance = 'cut' | 'demolish' | 'keep';
const CLEARANCES: readonly string[] = ['cut', 'demolish', 'keep'];

/**
 * Builds the drawn road in one undo step. A road that runs into buildings is not built until it is
 * said what to do with them; then they are cut or demolished first, as part of the same step.
 */
export function finishDrawing(choice?: unknown): void {
  const s = useEditor.getState();
  if (s.drawing.length < 2) { s.setDrawing([]); return; }
  const tags = ROAD_TEMPLATES[s.templateIndex].tags;
  const conflicts = drawingConflicts(s.doc, s.drawing, tags);
  const clearance = typeof choice === 'string' && CLEARANCES.includes(choice) ? (choice as Clearance) : null;
  if (conflicts.length && !clearance) {
    s.notify(`Дорога задевает ${conflicts.length === 1 ? 'здание' : `здания: ${conflicts.length}`}. Выберите: срезать, снести или построить поверх`);
    return;
  }
  const ids = conflicts.map((c) => c.wayId);
  const points = s.drawing;
  let wayId = '';
  s.apply((d) => {
    const cleared = clearance === 'cut' ? cutBuildings(d, ids, points, drawWidth(tags)) : clearance === 'demolish' ? demolishBuildings(d, ids) : d;
    const r = commitDrawing(cleared, points, tags);
    wayId = r.wayId;
    return r.doc;
  });
  s.setDrawing([]);
  if (wayId) s.select({ type: 'way', id: wayId });
  if (ids.length && clearance === 'cut') s.notify(`Дорога построена, зданий срезано по дороге: ${ids.length}`);
  if (ids.length && clearance === 'demolish') s.notify(`Дорога построена, зданий снесено: ${ids.length}`);
}

export function deleteSelection(): void {
  const s = useEditor.getState();
  const sel = currentSelection(s);
  if (!sel) return;
  if (sel.type === 'street') return;
  s.apply((d) => (sel.type === 'node' ? deleteNode(d, sel.id) : deleteWay(d, sel.id)));
  s.select(null);
}

export function reverseSelected(): void {
  const s = useEditor.getState();
  const sel = currentSelection(s);
  if (sel?.type === 'way') s.apply((d) => reverseWay(d, sel.id));
}

export function flipSelected(): void {
  const s = useEditor.getState();
  const sel = currentSelection(s);
  if (sel?.type === 'way') s.apply((d) => flipDirection(d, sel.id));
}

export function toggleSignalSelected(): void {
  const s = useEditor.getState();
  const sel = currentSelection(s);
  if (sel?.type === 'node') s.apply((d) => toggleSignal(d, sel.id));
}

/** Splits every way passing through the selected node (so attributes can differ on each side). */
export function splitAtSelected(): void {
  const s = useEditor.getState();
  const sel = currentSelection(s);
  if (sel?.type !== 'node') return;
  s.apply((d) => waysOfNode(d, sel.id).reduce((acc, w) => splitWay(acc, w.id, sel.id).doc, d));
  s.notify('Дороги разделены в узле');
}

/** Joins carriageways cut by the fragment edge with one-way connectors (see osm/cordon.ts). */
export function closeCordon(): void {
  const s = useEditor.getState();
  let added = 0;
  s.apply((d) => {
    const r = addAllCordonConnectors(d);
    added = r.added;
    return r.doc;
  });
  void refreshReport();
  s.notify(added ? `Добавлено кордонных разворотов: ${added}` : 'Разрезанных границей пар не найдено');
}
