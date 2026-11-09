import { useEffect } from 'react';
import { MapView } from './components/MapView';
import { Toolbar } from './components/Toolbar';
import { WayInspector } from './components/WayInspector';
import { NodeInspector } from './components/NodeInspector';
import { IssuesPanel } from './components/IssuesPanel';
import { CheckPanel } from './components/CheckPanel';
import { currentSelection, useEditor } from './state/store';
import { HOTKEYS, useHotkeys } from './state/useHotkeys';

const MESSAGE_TIMEOUT_MS = 3500;

const MODE_HINTS = {
  select: 'Клик — выбрать дорогу или узел. Перетаскивайте узлы; бросьте узел на другой, чтобы соединить.',
  draw: 'Кликайте точки новой дороги. Клик по дороге создаёт перекрёсток. Enter или двойной клик — готово, Esc — отмена.',
  insert: 'Клик по дороге добавляет узел (для изгиба или будущего перекрёстка).',
  signal: 'Клик по узлу ставит или убирает светофор. Клик по дороге — светофор в новой точке.',
} as const;

function Sidebar() {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => currentSelection(s));
  const mode = useEditor((s) => s.mode);
  const empty = !Object.keys(doc.nodes).length;
  return (
    <aside className="sidebar">
      {empty && <div className="welcome"><h3>Откройте файл .osm</h3><p>или нажмите «Пример», чтобы загрузить фрагмент Иркутска из задания.</p></div>}
      {!empty && <p className="mode-hint">{MODE_HINTS[mode]}</p>}
      {selection?.type === 'way' && <WayInspector way={doc.ways[selection.id]} />}
      {selection?.type === 'node' && <NodeInspector node={doc.nodes[selection.id]} />}
      {!empty && <IssuesPanel />}
      <details className="hotkeys">
        <summary>Горячие клавиши</summary>
        <dl>{HOTKEYS.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      </details>
    </aside>
  );
}

function Toast() {
  const message = useEditor((s) => s.message);
  const notify = useEditor((s) => s.notify);
  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(() => notify(null), MESSAGE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [message, notify]);
  return message ? <div className="toast">{message}</div> : null;
}

export function App() {
  useHotkeys();
  return (
    <div className="app">
      <Toolbar />
      <main>
        <MapView />
        <Sidebar />
      </main>
      <CheckPanel />
      <Toast />
    </div>
  );
}
