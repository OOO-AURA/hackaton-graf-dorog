import { useMemo } from 'react';
import type { OsmDoc } from '../osm/types';
import { useEditor } from '../state/store';

interface Change { added: number; removed: number; changed: number; names: string[] }

function diffMap<T extends { tags: Record<string, string> }>(a: Record<string, T>, b: Record<string, T>): Change {
  const c: Change = { added: 0, removed: 0, changed: 0, names: [] };
  for (const id in b) {
    if (!(id in a)) c.added += 1;
    else if (a[id] !== b[id]) { c.changed += 1; if (b[id].tags.name && c.names.length < 2) c.names.push(b[id].tags.name); }
  }
  for (const id in a) if (!(id in b)) c.removed += 1;
  return c;
}

function describe(a: OsmDoc, b: OsmDoc): { title: string; detail: string } {
  const ways = diffMap(a.ways, b.ways);
  const nodes = diffMap(a.nodes, b.nodes);
  const parts: string[] = [];
  if (ways.added) parts.push(`+${ways.added} лин.`);
  if (ways.removed) parts.push(`−${ways.removed} лин.`);
  if (ways.changed) parts.push(`${ways.changed} лин. изменено`);
  if (nodes.added) parts.push(`+${nodes.added} узл.`);
  if (nodes.removed) parts.push(`−${nodes.removed} узл.`);
  if (nodes.changed) parts.push(`${nodes.changed} узл. изменено`);
  let title = 'Правка';
  if (ways.added && !ways.removed) title = 'Новая дорога';
  else if (ways.removed || nodes.removed) title = 'Удаление';
  else if (nodes.changed && !ways.changed && !nodes.added) title = nodes.changed === 1 ? 'Узел' : 'Перемещение узлов';
  else if (ways.changed) title = 'Атрибуты дороги';
  if (ways.added > 1 && ways.removed === 0 && ways.changed === 0) title = 'Добавлены линии';
  const name = ways.names[0];
  return { title: name ? `${title} · ${name}` : title, detail: parts.join(' · ') || 'без изменений' };
}

/** Undo history as a list; clicking an entry steps the history to that point. */
export function Journal() {
  const past = useEditor((s) => s.past);
  const future = useEditor((s) => s.future);
  const doc = useEditor((s) => s.doc);
  const timeline = useMemo(() => [...past, doc, ...future], [past, doc, future]);
  const entries = useMemo(() => timeline.slice(1).map((d, i) => describe(timeline[i], d)), [timeline]);
  const current = past.length;

  const goTo = (target: number) => {
    const s = useEditor.getState();
    for (let i = s.past.length; i > target; i -= 1) useEditor.getState().undo();
    for (let i = useEditor.getState().past.length; i < target; i += 1) useEditor.getState().redo();
  };

  if (!entries.length) return <p className="hint dock-empty">Правок пока нет. Каждое изменение появится здесь, и к любому шагу можно вернуться кликом.</p>;
  return (
    <ol className="journal">
      <li className={current === 0 ? 'on' : ''}><button onClick={() => goTo(0)}><span className="mono step">00</span><span>Файл открыт</span></button></li>
      {entries.map((e, i) => (
        <li key={i} className={`${i + 1 === current ? 'on' : ''}${i + 1 > current ? ' undone' : ''}`}>
          <button onClick={() => goTo(i + 1)}>
            <span className="mono step">{String(i + 1).padStart(2, '0')}</span><span>{e.title}</span><span className="mono detail">{e.detail}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
