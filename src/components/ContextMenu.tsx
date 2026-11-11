import { useEffect, useRef, type ReactNode } from 'react';
import { isParkingArea } from '../osm/parking';
import { currentSelection, useEditor } from '../state/store';
import { useUi } from '../state/ui';
import { deleteSelection, flipSelected, reverseSelected, splitAtSelected, toggleSignalSelected } from '../state/actions';
import { copySelected, duplicateSelected, squareUpSelected } from '../state/buildingActions';
import { isBuilding } from '../osm/building';
import { direction } from '../osm/tags';
import { waysOfNode } from '../osm/edit';
import { junctions } from '../osm/lanes';
import { streetWays } from '../osm/street';
import { Icon, type IconName } from './icons';

interface Item { readonly label: string; readonly icon?: IconName; readonly key?: string; readonly run: () => void; readonly danger?: boolean; readonly edits?: boolean }

/** What can be done with the selection, as a right-click menu; the same actions as the inspector and the keys. */
function useItems(): { title: string; items: Item[] } | null {
  const doc = useEditor((s) => s.doc);
  const sel = useEditor((s) => currentSelection(s));
  const select = useEditor((s) => s.select);
  const openJunction = useUi((s) => s.setJunctionEditor);
  if (!sel || sel.type === 'street') return null;
  if (sel.type === 'node') {
    const node = doc.nodes[sel.id];
    if (!node) return null;
    const ways = waysOfNode(doc, sel.id);
    const inner = ways.some((w) => { const i = w.refs.indexOf(sel.id); return i > 0 && i < w.refs.length - 1; });
    const junction = junctions(doc).includes(sel.id);
    const signal = node.tags.highway === 'traffic_signals';
    return {
      title: junction ? 'Перекрёсток' : 'Узел',
      items: [
        ...(junction ? [{ label: 'Редактор перекрёстка', icon: 'node' as IconName, run: () => openJunction(sel.id) }] : []),
        ...(junction || signal ? [{ label: signal ? 'Убрать светофор' : 'Поставить светофор', icon: 'signal' as IconName, key: 'S', run: toggleSignalSelected, edits: true }] : []),
        ...(inner ? [{ label: 'Разрезать дороги здесь', icon: 'scissors' as IconName, key: 'X', run: splitAtSelected, edits: true }] : []),
        { label: 'Удалить узел', icon: 'trash', key: 'Del', run: deleteSelection, danger: true, edits: true },
      ],
    };
  }
  const way = doc.ways[sel.id];
  if (!way) return null;
  if (isParkingArea(way)) {
    return {
      title: way.tags.name || 'Парковка',
      items: [
        { label: 'Копия рядом', icon: 'parking', key: '⌘D', run: duplicateSelected, edits: true },
        { label: 'Скопировать', key: '⌘C', run: () => { copySelected(); } },
        { label: 'Выровнять углы до прямых', run: squareUpSelected, edits: true },
        { label: 'Удалить парковку', icon: 'trash', key: 'Del', run: deleteSelection, danger: true, edits: true },
      ],
    };
  }
  if (isBuilding(way.tags)) {
    return {
      title: 'Здание',
      items: [
        { label: 'Копия рядом', icon: 'building', key: '⌘D', run: duplicateSelected, edits: true },
        { label: 'Скопировать', key: '⌘C', run: () => { copySelected(); } },
        { label: 'Выровнять углы до прямых', run: squareUpSelected, edits: true },
        { label: 'Удалить здание', icon: 'trash', key: 'Del', run: deleteSelection, danger: true, edits: true },
      ],
    };
  }
  const name = way.tags.name;
  const parts = name ? streetWays(doc, name).length : 0;
  return {
    title: name || 'Дорога',
    items: [
      ...(sel.piece ? [{ label: 'Выбрать всю линию', run: () => select({ type: 'way', id: way.id }) }] : []),
      ...(parts > 1 ? [{ label: `Выбрать всю улицу (${parts})`, run: () => select({ type: 'street', id: name! }) }] : []),
      ...(way.tags.highway && direction(way.tags) !== 'both' ? [{ label: 'Сменить направление', icon: 'flip' as IconName, key: 'F', run: flipSelected, edits: true }] : []),
      { label: 'Развернуть линию', icon: 'reverse', key: 'R', run: reverseSelected, edits: true },
      { label: sel.piece ? 'Удалить участок' : 'Удалить дорогу', icon: 'trash', key: 'Del', run: deleteSelection, danger: true, edits: true },
    ],
  };
}

export function ContextMenu() {
  const at = useUi((s) => s.contextMenu);
  const close = useUi((s) => s.setContextMenu);
  const viewOnly = useEditor((s) => s.mode === 'view');
  const menu = useItems();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!at) return undefined;
    const shut = (e: Event) => { if (!(e.target instanceof Node && ref.current?.contains(e.target))) close(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(null); };
    window.addEventListener('pointerdown', shut, true);
    window.addEventListener('wheel', shut, true);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('pointerdown', shut, true); window.removeEventListener('wheel', shut, true); window.removeEventListener('keydown', onKey); };
  }, [at, close]);
  if (!at || !menu) return null;
  const items = menu.items.filter((i) => !(viewOnly && i.edits));
  const W = 240;
  const H = 40 + items.length * 34;
  const left = Math.min(at.x, window.innerWidth - W - 8);
  const top = Math.min(at.y, window.innerHeight - H - 8);
  const row = (i: Item): ReactNode => (
    <button key={i.label} role="menuitem" className={i.danger ? 'is-danger' : ''} onClick={() => { close(null); i.run(); }}>
      <span className="cm-icon">{i.icon && <Icon name={i.icon} size={15} />}</span>
      <span className="cm-label">{i.label}</span>
      {i.key && <kbd>{i.key}</kbd>}
    </button>
  );
  return (
    <div ref={ref} className="context-menu" role="menu" aria-label={menu.title} style={{ left, top, width: W }} onContextMenu={(e) => e.preventDefault()}>
      <p className="micro cm-title">{menu.title}</p>
      {items.map(row)}
      {viewOnly && <p className="hint cm-note">Режим «Просмотр»: правка выключена</p>}
    </div>
  );
}
