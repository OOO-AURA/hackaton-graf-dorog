import { useUi } from '../state/ui';
import { STEPS, type Step } from '../state/steps';

/** Tour anchors on the steps it points at. */
const TOUR_ANCHOR: Partial<Record<Step, string>> = { flows: 'flows-tab', sim: 'micro-toggle' };

/**
 * The steps of the work in the header: editing, macro, micro. The current one is filled; each
 * opens what it needs (see state/steps.ts).
 */
export function StepBar() {
  const step = useUi((s) => s.step);
  const setStep = useUi((s) => s.setStep);
  return (
    <nav className="steps" aria-label="Шаги работы">
      {STEPS.map((s) => (
        <button key={s.id} data-tour={TOUR_ANCHOR[s.id]} className={`step${step === s.id ? ' on' : ''}`} aria-current={step === s.id ? 'step' : undefined}
          onClick={() => setStep(s.id)} title={s.hint}>
          <span className="step-label">{s.label}</span>
        </button>
      ))}
    </nav>
  );
}
