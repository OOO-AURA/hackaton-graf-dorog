import { useEffect } from 'react';
import { useUi } from '../state/ui';
import { STEPS } from '../state/steps';
import { HOTKEYS } from '../state/useHotkeys';
import { TOOLS } from './tools';
import { Icon } from './icons';

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);

/** «?» opens and closes the help, Esc closes it. */
function useHelpKey(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      if (e.key === 'Escape' && ui.helpOpen) { ui.setHelpOpen(false); return; }
      if (e.key === '?' && !isTyping(e.target) && !e.metaKey && !e.ctrlKey) { e.preventDefault(); ui.setHelpOpen(!ui.helpOpen); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** How the work goes, what each tool does and every hotkey, on one screen. */
export function HelpDialog() {
  useHelpKey();
  const open = useUi((s) => s.helpOpen);
  const setOpen = useUi((s) => s.setHelpOpen);
  const setStep = useUi((s) => s.setStep);
  const hints = useUi((s) => s.mapHints);
  const setHints = useUi((s) => s.setMapHints);
  if (!open) return null;
  return (
    <div className="help-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <section className="help" role="dialog" aria-modal="true" aria-label="Как работать">
        <header className="help-head">
          <h2 className="display">Как работать</h2>
          <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Закрыть справку" title="Esc"><Icon name="close" /></button>
        </header>
        <div className="help-body">
          <div>
            <h3 className="micro">Шаги, слева направо в шапке</h3>
            <ol className="help-steps">
              {STEPS.map((s) => (
                <li key={s.id}>
                  <button className="help-step" onClick={() => { setStep(s.id); setOpen(false); }}>
                    <b>{s.label}</b>
                  </button>
                  <span className="hint">{s.hint}</span>
                </li>
              ))}
            </ol>
            <h3 className="micro">Инструменты на карте</h3>
            <dl className="help-tools">
              {TOOLS.map((t) => (
                <div key={t.mode}><dt><Icon name={t.icon} /> {t.label} <kbd>{t.key}</kbd></dt><dd>{t.hint}</dd></div>
              ))}
            </dl>
          </div>
          <div>
            <h3 className="micro">Горячие клавиши</h3>
            <dl className="help-keys">
              {HOTKEYS.map(([k, v]) => <div key={k}><dt className="mono">{k}</dt><dd>{v}</dd></div>)}
              <div><dt className="mono">?</dt><dd>Эта справка</dd></div>
            </dl>
            <label className="help-hints">
              <input type="checkbox" className="switch" checked={hints} onChange={(e) => setHints(e.target.checked)} />
              Подсказка внизу карты: что делать сейчас
            </label>
          </div>
        </div>
      </section>
    </div>
  );
}
