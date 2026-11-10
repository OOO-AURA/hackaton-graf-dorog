import { useEffect } from 'react';
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

function Badge({ tab }: { tab: BottomTab }) {
  const report = useEditor((s) => s.report);
  const check = useCheck((s) => s.report);
  const running = useCheck((s) => s.running);
  const logged = useErrorLog((s) => s.entries.filter((e) => e.kind === 'app' || !e.fixedAt).length);
  if (tab === 'issues' && report) {
    const errors = report.issues.filter((i) => i.severity === 'error').length;
    const all = report.issues.length;
    if (!all) return <span className="badge ok" aria-label="ошибок нет"><Icon name="check" size={11} /></span>;
    return <span className={`badge${errors ? ' err' : ' warn'}`}>{all}</span>;
  }
  if (tab === 'errors' && logged) return <span className="badge err">{logged}</span>;
  if (tab === 'check' && running) return <span className="badge spin" aria-label="идёт проверка" />;
  if (tab === 'check' && check) {
    const failed = check.stages.filter((s) => s.status === 'fail').length;
    return <span className={`badge ${failed ? 'err' : 'ok'}`}>{failed ? failed : <Icon name="check" size={11} />}</span>;
  }
  return null;
}

const TABS: ReadonlyArray<[BottomTab, string]> = [['issues', 'Валидация'], ['check', 'Проверка как на сервере'], ['flows', 'Потоки'], ['transit', 'Транспорт'], ['scenarios', 'Сценарии'], ['journal', 'Журнал'], ['errors', 'Ошибки']];

export function BottomDock() {
  const tab = useUi((s) => s.bottomTab);
  const open = useUi((s) => s.bottomOpen);
  const openBottom = useUi((s) => s.openBottom);
  const toggle = useUi((s) => s.toggleBottom);
  const running = useCheck((s) => s.running);
  const edits = useEditor((s) => s.past.length);
  const scenarios = useScenarios((s) => s.list.length);

  useEffect(() => { if (running) openBottom('check'); }, [running, openBottom]);

  return (
    <section className={`dock${open ? ' open' : ''}`} aria-label="Нижняя панель">
      {open && <Splitter axis="dockH" dir={-1} className="splitter-dock" />}
      <div className="dock-tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" data-tour={`${id}-tab`} aria-selected={open && tab === id} className={open && tab === id ? 'on' : ''}
            onClick={() => (open && tab === id ? toggle() : openBottom(id))}>
            {label}{id === 'scenarios' && scenarios > 0 && <span className="mono count">{scenarios}</span>}{id === 'journal' && edits > 0 && <span className="mono count">{edits}</span>}<Badge tab={id} />
          </button>
        ))}
        {open && <Why key={tab} id={tab} />}
        <button className="icon-btn dock-toggle" onClick={toggle} aria-label={open ? 'Свернуть панель' : 'Развернуть панель'} aria-expanded={open}>
          <Icon name="chevron" style={{ transform: open ? 'none' : 'rotate(180deg)' }} />
        </button>
      </div>
      {open && (
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
    </section>
  );
}
