import { useEffect, useState } from 'react';
import { useEditor } from '../state/store';
import { useUi, type BottomTab } from '../state/ui';
import { CheckPanel, useCheck } from './CheckPanel';
import { IssuesPanel } from './IssuesPanel';
import { Journal } from './Journal';
import { ErrorLogPanel } from './ErrorLogPanel';
import { useErrorLog } from '../state/errorLog';
import { FlowsPanel } from './FlowsPanel';
import { ScenariosPanel } from './ScenariosPanel';
import { TransitPanel } from './TransitPanel';
import { Icon } from './icons';
import { Why } from './Why';
import { Splitter } from './SidePanel';
import { useScenarios } from '../scenarios/store';
import { stepInfo } from '../state/steps';

function Badge({ tab }: { tab: BottomTab }) {
  const report = useEditor((s) => s.report);
  const check = useCheck((s) => s.report);
  const running = useCheck((s) => s.running);
  const logged = useErrorLog((s) => s.entries.filter((e) => e.kind === 'app' || !e.fixedAt).length);
  if (tab === 'issues' && report) {
    const errors = report.issues.filter((i) => i.severity === 'error').length;
    const all = report.issues.length;
    if (!all) return <span className="badge ok" aria-label="ошибок нет"><Icon name="check" size={11} /></span>;
    // Errors break the network in a simulator, remarks only make it less exact: two counts, not one sum.
    const remarks = all - errors;
    return (
      <>
        {errors > 0 && <span className="badge err" title={`Ошибок: ${errors}`}>{errors}</span>}
        {remarks > 0 && <span className="badge muted" title={`Замечаний: ${remarks}`}>{remarks}</span>}
      </>
    );
  }
  if (tab === 'errors' && logged) return <span className="badge err">{logged}</span>;
  if (tab === 'check' && running) return <span className="badge spin" aria-label="идёт проверка" />;
  if (tab === 'check' && check) {
    const failed = check.stages.filter((s) => s.status === 'fail').length;
    return <span className={`badge ${failed ? 'err' : 'ok'}`}>{failed ? failed : <Icon name="check" size={11} />}</span>;
  }
  return null;
}

export const TAB_LABELS: Readonly<Record<BottomTab, string>> = {
  issues: 'Ошибки графа', check: 'Отчёт сервера', flows: 'Потоки', transit: 'Транспорт', scenarios: 'Сценарии', journal: 'Что изменено', errors: 'Журнал ошибок',
};

/** How long the panel takes to slide open or shut, ms (layout.css says the same). */
const SLIDE_MS = 320;

export function BottomDock() {
  const tab = useUi((s) => s.bottomTab);
  const open = useUi((s) => s.bottomOpen);
  const openBottom = useUi((s) => s.openBottom);
  const toggle = useUi((s) => s.toggleBottom);
  const running = useCheck((s) => s.running);
  const edits = useEditor((s) => s.past.length);
  const scenarios = useScenarios((s) => s.list.length);
  const tabs = stepInfo(useUi((s) => s.step)).tabs;

  useEffect(() => { if (running) openBottom('check'); }, [running, openBottom]);
  // The panel slides: its content stays while it closes and goes once it is down.
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) { setShown(true); return undefined; }
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const t = window.setTimeout(() => setShown(false), reduce ? 0 : SLIDE_MS);
    return () => window.clearTimeout(t);
  }, [open]);

  return (
    <section className={`dock${open ? ' open' : ''}`} aria-label="Нижняя панель">
      {open && <Splitter axis="dockH" dir={-1} className="splitter-dock" />}
      <div className="dock-tabs" role="tablist">
        {tabs.map((id) => (
          <button key={id} role="tab" data-tour={`${id}-tab`} aria-selected={open && tab === id} className={open && tab === id ? 'on' : ''}
            onClick={() => (open && tab === id ? toggle() : openBottom(id))}>
            {TAB_LABELS[id]}{id === 'scenarios' && scenarios > 0 && <span className="mono count">{scenarios}</span>}{id === 'journal' && edits > 0 && <span className="mono count">{edits}</span>}<Badge tab={id} />
          </button>
        ))}
        {open && <Why key={tab} id={tab} />}
        <button className="icon-btn dock-toggle" onClick={toggle} aria-label={open ? 'Свернуть панель' : 'Развернуть панель'} aria-expanded={open}>
          <Icon name="chevron" style={{ transform: open ? 'none' : 'rotate(180deg)' }} />
        </button>
      </div>
      <div className="dock-drawer" aria-hidden={!open}>
      {shown && (
        <div className="dock-body" role="tabpanel">
          {tab === 'issues' && <IssuesPanel />}
          {tab === 'check' && <CheckPanel />}
          {tab === 'flows' && <FlowsPanel />}
          {tab === 'transit' && <TransitPanel />}
          {tab === 'scenarios' && <ScenariosPanel />}
          {tab === 'journal' && <Journal />}
          {tab === 'errors' && <ErrorLogPanel />}
        </div>
      )}
      </div>
    </section>
  );
}
