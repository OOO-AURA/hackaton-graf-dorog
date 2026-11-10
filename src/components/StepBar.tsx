import { useEditor } from '../state/store';
import { useUi } from '../state/ui';
import { STEPS, type Step } from '../state/steps';
import { useCheck } from './CheckPanel';
import { Icon } from './icons';

/** Tour anchors on the steps it points at. */
const TOUR_ANCHOR: Partial<Record<Step, string>> = { flows: 'flows-tab', sim: 'micro-toggle' };

/** Small mark on a step: errors left on the check step, the server check result on the last one. */
function StepMark({ step }: { step: Step }) {
  const errors = useEditor((s) => s.report?.issues.filter((i) => i.severity === 'error').length ?? null);
  const check = useCheck((s) => s.report);
  if (step === 'check' && errors !== null) {
    return errors ? <span className="badge err" aria-label={`ошибок: ${errors}`}>{errors}</span> : <span className="badge ok" aria-label="ошибок нет"><Icon name="check" size={11} /></span>;
  }
  if (step === 'submit' && check) {
    const failed = check.stages.some((s) => s.status === 'fail');
    return <span className={`badge ${failed ? 'err' : 'ok'}`} aria-label={failed ? 'проверка не пройдена' : 'проверка пройдена'}>{failed ? '!' : <Icon name="check" size={11} />}</span>;
  }
  return null;
}

/**
 * The five steps of the work in the header, numbered in the order they are done.
 * The current one is filled; each opens what it needs (see state/steps.ts).
 */
export function StepBar() {
  const step = useUi((s) => s.step);
  const setStep = useUi((s) => s.setStep);
  return (
    <nav className="steps" aria-label="Шаги работы">
      {STEPS.map((s, i) => (
        <button key={s.id} data-tour={TOUR_ANCHOR[s.id]} className={`step${step === s.id ? ' on' : ''}`} aria-current={step === s.id ? 'step' : undefined}
          onClick={() => setStep(s.id)} title={s.hint}>
          <span className="step-n mono" aria-hidden="true">{i + 1}</span>
          <span className="step-label">{s.label}</span>
          <StepMark step={s.id} />
        </button>
      ))}
    </nav>
  );
}
