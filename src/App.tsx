import { useEffect } from 'react';
import { MapView } from './components/MapView';
import { Header } from './components/Header';
import { Navigator } from './components/Navigator';
import { Inspector } from './components/Inspector';
import { BottomDock } from './components/BottomDock';
import { MicroPanel } from './components/sim/MicroPanel';
import { useEditor } from './state/store';
import { refreshReport } from './state/validation';
import { startAutosave } from './state/draft';
import { Guide } from './components/guide/Guide';
import { useUi } from './state/ui';
import { useHotkeys } from './state/useHotkeys';
import { useCloseGuard } from './state/useCloseGuard';
import { usePanels } from './state/panels';
import { SidePanel } from './components/SidePanel';
import type { CSSProperties } from 'react';
import { useCheck } from './components/CheckPanel';
import { useSim } from './sim/store';
import { startErrorLog, useErrorLog } from './state/errorLog';
import { JunctionEditor } from './components/JunctionEditor';

const MESSAGE_TIMEOUT_MS = 3500;
const VALIDATE_DELAY_MS = 350;

function Toast() {
  const message = useEditor((s) => s.message);
  const notify = useEditor((s) => s.notify);
  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(() => notify(null), MESSAGE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [message, notify]);
  return message ? <div className="toast" role="status" key={message}>{message}</div> : null;
}

/** Puts the resolved theme on <html> and follows the system setting while no manual choice is made. */
function useTheme(): void {
  const theme = useUi((s) => s.theme);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => useUi.getState().syncSystemTheme();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
}

/** Re-runs the graph check shortly after each edit, so the validation tab and the map markers stay current. */
function useLiveValidation(): void {
  const doc = useEditor((s) => s.doc);
  const hasReport = useEditor((s) => s.report !== null);
  useEffect(() => {
    if (hasReport || !Object.keys(doc.nodes).length) return undefined;
    const timer = window.setTimeout(() => void refreshReport(), VALIDATE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [doc, hasReport]);
}

/** Feeds the error log: failures written to the console, graph errors as edits bring them in, SUMO and check failures. */
function useErrorLogFeeds(): void {
  useEffect(() => {
    const stopConsole = startErrorLog();
    const stopIssues = useEditor.subscribe((s, prev) => { if (s.report && s.report !== prev.report) useErrorLog.getState().syncIssues(s.report.issues, s.doc === s.baseDoc); });
    const stopSim = useSim.subscribe((s, prev) => { if (s.error && s.error !== prev.error) useErrorLog.getState().add('app', `SUMO: ${s.error}`); });
    const stopCheck = useCheck.subscribe((s, prev) => { if (s.error && s.error !== prev.error) useErrorLog.getState().add('app', `Проверка как на сервере: ${s.error}`); });
    return () => { stopConsole(); stopIssues(); stopSim(); stopCheck(); };
  }, []);
}

export function App() {
  useHotkeys();
  useTheme();
  useLiveValidation();
  useCloseGuard();
  useEffect(() => startAutosave(), []);
  useErrorLogFeeds();
  const empty = useEditor((s) => !Object.keys(s.doc.nodes).length);
  const workspace = useUi((s) => s.workspace);
  const p = usePanels();
  const vars = {
    '--nav-w': `${p.navOpen ? p.navW : 28}px`,
    '--insp-w': `${p.inspOpen ? p.inspW : 28}px`,
    '--dock-h': `${p.dockH}px`,
  } as CSSProperties;
  return (
    <div className={`app${empty ? ' is-empty' : ''}`} style={vars}>
      <Header />
      <SidePanel side="left" title="Навигатор"><Navigator /></SidePanel>
      <main className="center">
        <MapView />
      </main>
      <SidePanel side="right" title="Инспектор">{workspace === 'micro' ? <MicroPanel /> : <Inspector />}</SidePanel>
      <BottomDock />
      <JunctionEditor />
      <Toast />
      <Guide />
    </div>
  );
}
