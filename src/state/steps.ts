import type { BottomTab, Workspace } from './ui';

/**
 * The work in three steps, shown in the header: edit the graph, look at the flows (macro), run
 * the simulation (micro). Checking and handing in are not steps: their tabs are always at the
 * bottom (ALWAYS_TABS); each step adds its own tabs after them.
 */

export type Step = 'edit' | 'flows' | 'sim';

/** Tabs of the bottom panel in every step: errors of the graph, the error log, the server check, hand-in, the journal. */
export const ALWAYS_TABS: readonly BottomTab[] = ['issues', 'errors', 'check', 'submit', 'journal'];

export interface StepInfo {
  readonly id: Step;
  readonly label: string;
  /** One line under the step: what it is for. */
  readonly hint: string;
  readonly workspace: Workspace;
  /** Tabs of the bottom panel in this step, in order. */
  readonly tabs: readonly BottomTab[];
  /** Tab opened when the step is chosen; none keeps the bottom panel shut. */
  readonly opens: BottomTab | null;
}

const withAlways = (own: readonly BottomTab[]): readonly BottomTab[] => [...own, ...ALWAYS_TABS.filter((t) => !own.includes(t))];

export const STEPS: readonly StepInfo[] = [
  { id: 'edit', label: 'Редактирование', hint: 'Рисуйте и правьте дороги, перекрёстки, знаки и здания', workspace: 'macro', tabs: withAlways([]), opens: null },
  { id: 'flows', label: 'Макро', hint: 'Макроуровень: зоны, матрица поездок и загрузка дорог в час пик', workspace: 'macro', tabs: withAlways(['flows', 'transit', 'scenarios']), opens: 'flows' },
  { id: 'sim', label: 'Микро', hint: 'Микроуровень, SUMO: машины по полосам, светофоры, задержки', workspace: 'micro', tabs: withAlways(['scenarios']), opens: null },
];

export const stepInfo = (id: Step): StepInfo => STEPS.find((s) => s.id === id) ?? STEPS[0];

/** The step a tab belongs to: the current one if it has the tab, else the first step that opens it, else the first that has it. */
export function stepForTab(tab: BottomTab, current: Step): Step {
  if (stepInfo(current).tabs.includes(tab)) return current;
  return (STEPS.find((s) => s.opens === tab) ?? STEPS.find((s) => s.tabs.includes(tab)) ?? STEPS[0]).id;
}

/** The step that matches a workspace switched to from elsewhere (the tour, a hotkey). */
export function stepForWorkspace(workspace: Workspace, current: Step): Step {
  if (workspace === 'micro') return 'sim';
  return current === 'sim' ? 'edit' : current;
}
