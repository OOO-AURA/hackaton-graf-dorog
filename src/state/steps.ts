import type { BottomTab, Workspace } from './ui';

/**
 * The work goes in five steps, shown in the header in order: edit the graph, check it, look at
 * the flows, run the simulation, hand the file in. Each step brings its own tabs into the bottom
 * panel, so only what the step needs is on screen.
 */

export type Step = 'edit' | 'check' | 'flows' | 'sim' | 'submit';

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

export const STEPS: readonly StepInfo[] = [
  { id: 'edit', label: 'Правка', hint: 'Рисуйте и правьте дороги, перекрёстки, знаки и здания', workspace: 'macro', tabs: ['issues', 'journal'], opens: null },
  { id: 'check', label: 'Проверка', hint: 'Ошибки графа и потоков, многие исправляются одной кнопкой', workspace: 'macro', tabs: ['issues', 'errors', 'journal'], opens: 'issues' },
  { id: 'flows', label: 'Потоки', hint: 'Зоны, матрица поездок и загрузка дорог в час пик', workspace: 'macro', tabs: ['flows', 'transit', 'scenarios'], opens: 'flows' },
  { id: 'sim', label: 'Симуляция', hint: 'SUMO: машины по полосам, светофоры, задержки', workspace: 'micro', tabs: ['scenarios', 'errors'], opens: null },
  { id: 'submit', label: 'Сдача', hint: 'Проверка как на сервере, сохранение и экспорт', workspace: 'macro', tabs: ['submit', 'check', 'journal'], opens: 'submit' },
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
