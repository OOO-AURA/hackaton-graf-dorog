import { useEffect, useLayoutEffect, useState } from 'react';
import { create } from 'zustand';
import { useMacro } from '../macro/store';
import { useEditor } from '../state/store';
import { useUi } from '../state/ui';

const KEY = 'graf-tour';

/** First-run path through the three things the app is for: edit, see flows, check in SUMO. */
export const TOUR = [
  { anchor: 'inspector', title: 'Правка', text: 'Кликните дорогу на карте. Справа появятся её полосы, класс и скорость: поменяйте что-нибудь, например число полос.', side: 'left' },
  { anchor: 'flows-tab', title: 'Потоки', text: 'Откройте «Потоки» и нажмите «Распределить потоки». Цвет дорог покажет загрузку в час пик уже с вашей правкой.', side: 'top' },
  { anchor: 'micro-toggle', title: 'Микро', text: 'Переключитесь в «Микро» и запустите SUMO: машины поедут по полосам, а панель покажет задержку и уровень обслуживания.', side: 'bottom' },
] as const;

function readStep(): number | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'done' ? null : Number(v) || 0;
  } catch {
    return 0;
  }
}

function writeStep(step: number | null): void {
  try { localStorage.setItem(KEY, step === null ? 'done' : String(step)); } catch { /* private mode: the tour just shows again */ }
}

export const useTour = create<{ step: number | null; go: (step: number | null) => void }>((set) => ({
  step: readStep(),
  go: (step) => { const s = step !== null && step >= TOUR.length ? null : step; writeStep(s); set({ step: s }); },
}));

/** Moves the tour on when the user does what the current step asks. */
function useAdvance(step: number | null): void {
  const edits = useEditor((s) => s.past.length);
  const flows = useMacro((s) => s.result !== null);
  const workspace = useUi((s) => s.workspace);
  const go = useTour((s) => s.go);
  useEffect(() => {
    if (step === 0 && edits > 0) go(1);
    else if (step === 1 && flows) go(2);
    else if (step === 2 && workspace === 'micro') go(null);
  }, [step, edits, flows, workspace, go]);
}

function useAnchorRect(anchor: string | null): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    if (!anchor) { setRect(null); return undefined; }
    const same = (a: DOMRect | null, b: DOMRect | null) => a === b || (!!a && !!b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height);
    // Polled because panels move without resizing the window; unchanged boxes do not re-render.
    const update = () => {
      const next = document.querySelector(`[data-tour="${anchor}"]`)?.getBoundingClientRect() ?? null;
      setRect((prev) => (same(prev, next) ? prev : next));
    };
    update();
    const timer = setInterval(update, 500);
    window.addEventListener('resize', update);
    return () => { clearInterval(timer); window.removeEventListener('resize', update); };
  }, [anchor]);
  return rect;
}

const W = 280;

/** Coach mark next to the element of the current step; hidden until a graph is open. */
export function Tour() {
  const step = useTour((s) => s.step);
  const go = useTour((s) => s.go);
  const hasGraph = useEditor((s) => Object.keys(s.doc.nodes).length > 0);
  useAdvance(hasGraph ? step : null);
  const current = hasGraph && step !== null ? TOUR[step] : null;
  const rect = useAnchorRect(current?.anchor ?? null);
  if (!current || !rect) return null;
  const gap = 12;
  const pos = current.side === 'left'
    ? { left: Math.max(8, rect.left - W - gap), top: Math.max(8, rect.top + 40) }
    : current.side === 'top'
      ? { left: Math.min(window.innerWidth - W - 8, Math.max(8, rect.left)), bottom: window.innerHeight - rect.top + gap }
      : { left: Math.min(window.innerWidth - W - 8, Math.max(8, rect.left + rect.width / 2 - W / 2)), top: rect.bottom + gap };
  return (
    <div className={`tour tour-${current.side}`} role="dialog" aria-label="Подсказка" style={{ ...pos, width: W }}>
      <p className="micro">Шаг {step! + 1} из {TOUR.length} · {current.title}</p>
      <p>{current.text}</p>
      <div className="tour-actions">
        <button className="btn btn-sm btn-quiet" onClick={() => go(null)}>Не показывать</button>
        <button className="btn btn-sm btn-ink" onClick={() => go(step! + 1)}>{step! + 1 < TOUR.length ? 'Дальше' : 'Готово'}</button>
      </div>
    </div>
  );
}
