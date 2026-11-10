import { STEPS, stepForTab, stepForWorkspace } from './steps';
import { useUi } from './ui';

describe('steps of the work', () => {
  beforeEach(() => useUi.getState().setStep('edit'));

  test('every tab of the bottom panel belongs to some step', () => {
    const tabs = new Set(STEPS.flatMap((s) => s.tabs));
    for (const t of ['issues', 'check', 'flows', 'transit', 'scenarios', 'journal', 'errors', 'submit']) expect(tabs.has(t as never)).toBe(true);
  });

  test('choosing a step opens its tab and the model level it needs', () => {
    useUi.getState().setStep('flows');
    expect(useUi.getState()).toMatchObject({ workspace: 'macro', bottomTab: 'flows', bottomOpen: true });
    useUi.getState().setStep('sim');
    expect(useUi.getState()).toMatchObject({ workspace: 'micro', bottomOpen: false });
    useUi.getState().setStep('edit');
    expect(useUi.getState()).toMatchObject({ workspace: 'macro', bottomOpen: false });
  });

  test('checks and hand-in are tabs of every step, opening one keeps the step', () => {
    for (const s of STEPS) for (const t of ['issues', 'errors', 'check', 'submit', 'journal']) expect(s.tabs).toContain(t);
    useUi.getState().setStep('flows');
    useUi.getState().openBottom('check');
    expect(useUi.getState().step).toBe('flows');
    useUi.getState().openBottom('transit');
    expect(useUi.getState().step).toBe('flows');
  });

  test('switching to Micro from elsewhere moves to the simulation, and back to editing', () => {
    useUi.getState().setWorkspace('micro');
    expect(useUi.getState().step).toBe('sim');
    useUi.getState().setWorkspace('macro');
    expect(useUi.getState().step).toBe('edit');
  });

  test('a tab of the current step keeps the step', () => {
    expect(stepForTab('issues', 'sim')).toBe('sim');
    expect(stepForTab('flows', 'edit')).toBe('flows');
    expect(stepForWorkspace('macro', 'flows')).toBe('flows');
  });
});
