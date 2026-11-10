import type { ReactNode, PointerEvent as RPointerEvent } from 'react';
import { usePanels } from '../state/panels';
import { Icon } from './icons';

type Axis = 'navW' | 'inspW' | 'dockH';

/** Drag handle on a panel edge. `dir` is +1 when dragging right/down grows the panel. */
export function Splitter({ axis, dir, className }: { axis: Axis; dir: 1 | -1; className: string }) {
  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const vertical = axis === 'dockH';
    const start = vertical ? e.clientY : e.clientX;
    const base = usePanels.getState()[axis];
    document.body.classList.add(vertical ? 'resizing-y' : 'resizing-x');
    const move = (ev: PointerEvent) => {
      const delta = ((vertical ? ev.clientY : ev.clientX) - start) * dir;
      usePanels.getState().set({ [axis]: base + delta });
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      document.body.classList.remove('resizing-x', 'resizing-y');
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  return <div className={`splitter ${className}`} role="separator" aria-orientation={axis === 'dockH' ? 'horizontal' : 'vertical'} onPointerDown={onDown} />;
}

/** A side panel docked flush to the window edge: resizable, collapsible to a thin rail. */
export function SidePanel({ side, title, children }: { side: 'left' | 'right'; title: string; children: ReactNode }) {
  const key = side === 'left' ? 'navOpen' : 'inspOpen';
  const open = usePanels((s) => s[key]);
  const set = usePanels((s) => s.set);
  const toggle = () => set({ [key]: !open });
  const chevron = side === 'left' ? (open ? 90 : -90) : (open ? -90 : 90);
  return (
    <div className={`side side-${side}${open ? '' : ' collapsed'}`}>
      <button className="side-toggle icon-btn" onClick={toggle} aria-expanded={open} aria-label={open ? `Свернуть: ${title}` : `Развернуть: ${title}`} title={open ? 'Свернуть' : title}>
        <Icon name="chevron" size={14} style={{ transform: `rotate(${chevron}deg)` }} />
      </button>
      {open ? children : <button className="side-rail" onClick={toggle}><span>{title}</span></button>}
      {open && <Splitter axis={side === 'left' ? 'navW' : 'inspW'} dir={side === 'left' ? 1 : -1} className={`splitter-${side}`} />}
    </div>
  );
}
