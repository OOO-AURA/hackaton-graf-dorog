import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useUi } from '../state/ui';
import { LENSES, type Lens } from '../map/lens';
import { BasemapBlock, LENS_HINT, openViewSettings, pickLens } from './ViewSettings';
import { Icon } from './icons';

/**
 * The view mode switch on top of the map, an island that grows out of itself: closed it is a
 * pill with the mode in use, a click opens it into the list of modes with the basemap under them.
 * A click outside, Esc or picking a mode closes it again.
 */

const GLYPH: Readonly<Record<Lens, ReactNode>> = {
  all: <><rect x="3" y="3" width="6" height="6" rx="1.2" /><rect x="11" y="3" width="6" height="6" rx="1.2" /><rect x="3" y="11" width="6" height="6" rx="1.2" /><rect x="11" y="11" width="6" height="6" rx="1.2" /></>,
  car: <><path d="M4 12.5l1.6-4.3A2 2 0 017.5 7h5a2 2 0 011.9 1.2l1.6 4.3" /><rect x="3" y="12" width="14" height="3.6" rx="1.2" /><circle cx="6.5" cy="15.8" r="1" /><circle cx="13.5" cy="15.8" r="1" /></>,
  signs: <><path d="M10 2.8l7 12.4H3z" /><path d="M10 8v3.5M10 13.4v.1" /></>,
  walk: <><circle cx="10.5" cy="3.8" r="1.6" /><path d="M9.6 7l-2.4 3.2 2.8 1.8-1.2 5M9.6 7l2.6 2.4 2.3.6M10 12l2.6 5" /></>,
  transit: <><rect x="4.5" y="2.8" width="11" height="12" rx="2.4" /><path d="M4.5 9.5h11M7 17.5l1-2.7M13 17.5l-1-2.7" /><circle cx="7.6" cy="12.3" r="0.6" /><circle cx="12.4" cy="12.3" r="0.6" /></>,
  rail: <><path d="M6.5 2.5L4.5 17.5M13.5 2.5l2 15M5.6 6h8.8M5.1 10h9.8M4.7 14h10.6" /></>,
  metro: <><circle cx="10" cy="10" r="7" /><path d="M6 13.5V7l4 4.5L14 7v6.5" /></>,
  load: <><path d="M3 16h14" /><path d="M5 16v-4M9 16V7M13 16v-6M17 16V4" /></>,
};

function Glyph({ lens }: { lens: Lens }) {
  return <svg className="island-glyph" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{GLYPH[lens]}</svg>;
}

export function ViewNote() {
  const micro = useUi((s) => s.workspace === 'micro');
  const lens = useUi((s) => s.lens);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: PointerEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey, true); };
  }, [open]);
  const label = LENSES.find(([v]) => v === lens)?.[1] ?? '';
  return (
    <div className={`float-view${micro ? ' is-micro' : ''}`}>
      <div ref={root} className={`island${open ? ' open' : ''}`} data-tour="view-island">
        <button className="island-pill" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="true" title="Режим вида: что видно и что можно править">
          <Glyph lens={lens} />
          <span className="island-title">Вид карты</span>
          <b className="island-mode">{label}</b>
          <Icon name="chevron" size={14} className="island-chev" />
        </button>
        <div className="island-body" aria-hidden={!open}>
          <div className="island-inner">
            <div className="island-modes" role="radiogroup" aria-label="Режим вида">
              {LENSES.map(([v, text]) => (
                <button key={v} role="radio" aria-checked={lens === v} tabIndex={open ? 0 : -1} className={`island-mode-btn${lens === v ? ' on' : ''}`}
                  onClick={() => { pickLens(v); setOpen(false); }}>
                  <Glyph lens={v} />
                  <span><b>{text}</b><span className="hint">{LENS_HINT[v]}</span></span>
                </button>
              ))}
            </div>
            <div className="island-basemap"><BasemapBlock /></div>
            <button className="link-btn island-more" tabIndex={open ? 0 : -1} onClick={() => { openViewSettings(); setOpen(false); }}>Все слои карты →</button>
          </div>
        </div>
      </div>
    </div>
  );
}
