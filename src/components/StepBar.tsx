import { useLayoutEffect, useRef, useState } from 'react';
import { useUi } from '../state/ui';
import { STEPS, type Step } from '../state/steps';

/** Tour anchors on the steps it points at. */
const TOUR_ANCHOR: Partial<Record<Step, string>> = { flows: 'flows-tab', sim: 'micro-toggle' };

/**
 * The steps of the work in the header: editing, macro, micro, as one segmented control. A thumb
 * slides under the current step; each step opens what it needs (see state/steps.ts).
 */
export function StepBar() {
  const step = useUi((s) => s.step);
  const setStep = useUi((s) => s.setStep);
  const bar = useRef<HTMLElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = bar.current?.querySelector<HTMLElement>('.step.on');
      if (el) setThumb({ left: el.offsetLeft, width: el.offsetWidth });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    if (bar.current) ro.observe(bar.current);
    return () => ro.disconnect();
  }, [step]);
  return (
    <nav ref={bar} className="steps" aria-label="Шаги работы">
      {thumb && <span className="steps-thumb" style={{ transform: `translateX(${thumb.left}px)`, width: thumb.width }} aria-hidden="true" />}
      {STEPS.map((s) => (
        <button key={s.id} data-tour={TOUR_ANCHOR[s.id]} className={`step${step === s.id ? ' on' : ''}`} aria-current={step === s.id ? 'step' : undefined}
          onClick={() => setStep(s.id)} title={s.hint}>
          <span className="step-label">{s.label}</span>
        </button>
      ))}
    </nav>
  );
}
