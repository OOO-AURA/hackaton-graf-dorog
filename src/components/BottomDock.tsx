import { useEffect } from 'react';
import type { Issue } from '../osm/validate';
import { useEditor } from '../state/store';
import { useUi, type BottomTab } from '../state/ui';
import { CheckPanel, useCheck } from './CheckPanel';
import { IssuesPanel, KIND_LABELS } from './IssuesPanel';
import { Journal } from './Journal';
import { Icon } from './icons';

function Connectivity() {
  const report = useEditor((s) => s.report);
  if (!report) return <p className="hint dock-empty">Считаю…</p>;
  const { stats } = report;
  const count = (kind: Issue['kind']) => report.issues.filter((i) => i.kind === kind).length;
  const tiles: ReadonlyArray<[string, string, string?]> = [
    ['Дорог', String(stats.ways)], ['Узлов', String(stats.nodes)], ['Длина, км', stats.lengthKm.toFixed(1)],
    ['Светофоров', String(stats.signals)], ['Компонент связности', String(stats.components), stats.components > 1 ? 'warn' : 'ok'],
  ];
  return (
    <div className="graph-tab">
      <div className="tiles">
        {tiles.map(([label, value, tone]) => (
          <div key={label} className={`tile ${tone ?? ''}`}><span className="tile-value">{value}</span><span className="micro">{label}</span></div>
        ))}
      </div>
      <ul className="graph-breakdown">
        {(Object.keys(KIND_LABELS) as Issue['kind'][]).map((k) => (
          <li key={k} className={count(k) ? 'has' : ''}><span>{KIND_LABELS[k]}</span><span className="mono">{count(k)}</span></li>
        ))}
      </ul>
      <p className="hint">Одна компонента значит, что из любой точки сети можно доехать в любую другую. Лишние компоненты и тупики по направлению MATSim выкидывает из сети, агенты по ним не поедут.</p>
    </div>
  );
}

function Badge({ tab }: { tab: BottomTab }) {
  const report = useEditor((s) => s.report);
  const check = useCheck((s) => s.report);
  const running = useCheck((s) => s.running);
  if (tab === 'issues' && report) {
    const errors = report.issues.filter((i) => i.severity === 'error').length;
    const all = report.issues.length;
    if (!all) return <span className="badge ok" aria-label="ошибок нет"><Icon name="check" size={11} /></span>;
    return <span className={`badge${errors ? ' err' : ' warn'}`}>{all}</span>;
  }
  if (tab === 'check' && running) return <span className="badge spin" aria-label="идёт проверка" />;
  if (tab === 'check' && check) {
    const failed = check.stages.filter((s) => s.status === 'fail').length;
    return <span className={`badge ${failed ? 'err' : 'ok'}`}>{failed ? failed : <Icon name="check" size={11} />}</span>;
  }
  return null;
}

const TABS: ReadonlyArray<[BottomTab, string]> = [['issues', 'Валидация'], ['check', 'Проверка как на сервере'], ['journal', 'Журнал'], ['graph', 'Связность']];

export function BottomDock() {
  const tab = useUi((s) => s.bottomTab);
  const open = useUi((s) => s.bottomOpen);
  const openBottom = useUi((s) => s.openBottom);
  const toggle = useUi((s) => s.toggleBottom);
  const running = useCheck((s) => s.running);
  const edits = useEditor((s) => s.past.length);

  useEffect(() => { if (running) openBottom('check'); }, [running, openBottom]);

  return (
    <section className={`dock${open ? ' open' : ''}`} aria-label="Нижняя панель">
      <div className="dock-tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={open && tab === id} className={open && tab === id ? 'on' : ''}
            onClick={() => (open && tab === id ? toggle() : openBottom(id))}>
            {label}{id === 'journal' && edits > 0 && <span className="mono count">{edits}</span>}<Badge tab={id} />
          </button>
        ))}
        <button className="icon-btn dock-toggle" onClick={toggle} aria-label={open ? 'Свернуть панель' : 'Развернуть панель'} aria-expanded={open}>
          <Icon name="chevron" style={{ transform: open ? 'none' : 'rotate(180deg)' }} />
        </button>
      </div>
      {open && (
        <div className="dock-body" role="tabpanel">
          {tab === 'issues' && <IssuesPanel />}
          {tab === 'check' && <CheckPanel />}
          {tab === 'journal' && <Journal />}
          {tab === 'graph' && <Connectivity />}
        </div>
      )}
    </section>
  );
}
