import { hasRepairs, OsmParseError, parseOsmChecked, type OsmRepairs } from '../osm/parse';
import { serializeOsm } from '../osm/serialize';
import { commitDrawing } from '../osm/draw';
import { deleteNode, deleteWay, flipDirection, reverseWay, splitWay, toggleSignal, waysOfNode } from '../osm/edit';
import { ROAD_TEMPLATES } from '../osm/tags';
import { addAllCordonConnectors } from '../osm/cordon';
import { currentSelection, useEditor } from './store';
import { refreshReport } from './validation';
import { baseName, downloadText, isDesktop, openOsmFile, saveOsmFile } from '../platform';

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

/** Short note on what was dropped while opening a damaged file. */
export function repairText(r: OsmRepairs): string {
  const parts: string[] = [];
  if (r.badNodes) parts.push(`узлов без координат: ${r.badNodes}`);
  if (r.danglingRefs) parts.push(`ссылок на отсутствующие узлы: ${r.danglingRefs}`);
  if (r.droppedWays) parts.push(`линий, от которых осталось меньше двух узлов: ${r.droppedWays}`);
  return `Файл повреждён, при открытии убрано ${parts.join(', ')}`;
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
  if (errors > 0 && !window.confirm(`Проверка нашла ошибок: ${errors}. Они видны на панели «Проверка». Сохранить всё равно?`)) return;
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

export function finishDrawing(): void {
  const s = useEditor.getState();
  if (s.drawing.length < 2) { s.setDrawing([]); return; }
  let wayId = '';
  s.apply((d) => {
    const r = commitDrawing(d, s.drawing, ROAD_TEMPLATES[s.templateIndex].tags);
    wayId = r.wayId;
    return r.doc;
  });
  s.setDrawing([]);
  if (wayId) s.select({ type: 'way', id: wayId });
}

export function deleteSelection(): void {
  const s = useEditor.getState();
  const sel = currentSelection(s);
  if (!sel) return;
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
