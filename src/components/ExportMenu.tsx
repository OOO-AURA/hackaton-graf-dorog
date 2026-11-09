import { useRef } from 'react';
import { toMatsimNetwork } from '../osm/matsim';
import { serializeOsm } from '../osm/serialize';
import { exportSumoNet, isDesktop, saveTextFile } from '../platform';
import { mapSnapshot } from '../map/instance';
import { useMacro } from '../macro/store';
import { buildReport } from '../report/report';
import { useScenarios } from '../scenarios/store';
import { useSim } from '../sim/store';
import { useEditor } from '../state/store';
import { wayLabel } from './sim/MicroPanel';

const stem = () => (useEditor.getState().saveName.trim() || 'graph').replace(/\.osm$/i, '');

async function exportAs(kind: 'sumo' | 'matsim'): Promise<void> {
  const s = useEditor.getState();
  try {
    const done = kind === 'sumo'
      ? await exportSumoNet(serializeOsm(s.doc), `${stem()}.net.xml`)
      : await saveTextFile(toMatsimNetwork(s.doc), `${stem()}.network.xml`, 'MATSim network', 'xml');
    if (done) s.notify(kind === 'sumo' ? 'Сеть SUMO записана' : 'Сеть MATSim записана');
  } catch (err) {
    s.notify(String(err));
  }
}

async function exportReport(): Promise<void> {
  const s = useEditor.getState();
  const sim = useSim.getState();
  try {
    const html = buildReport({
      fileName: `${stem()}.osm`, date: new Date(), doc: s.doc,
      macro: useMacro.getState().result, sim: sim.result, baseline: sim.baseline,
      scenarios: useScenarios.getState().list, mapImage: await mapSnapshot(),
      wayName: (id) => wayLabel(s.doc.ways[id], id),
    });
    if (await saveTextFile(html, `${stem()}-report.html`, 'HTML', 'html')) s.notify('Отчёт записан. Для PDF откройте его в браузере и напечатайте');
  } catch (err) {
    s.notify(String(err));
  }
}

/** Exports the graph straight into the formats the simulators read, next to the .osm save. */
export function ExportMenu({ disabled }: { disabled: boolean }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pick = (kind: 'sumo' | 'matsim' | 'report') => { ref.current?.removeAttribute('open'); void (kind === 'report' ? exportReport() : exportAs(kind)); };
  return (
    <details className="menu" ref={ref}>
      <summary className={`btn btn-quiet${disabled ? ' is-disabled' : ''}`} aria-disabled={disabled} onClick={(e) => { if (disabled) e.preventDefault(); }}>Экспорт</summary>
      <div className="menu-list" role="menu">
        <button role="menuitem" onClick={() => pick('sumo')} disabled={!isDesktop} title={isDesktop ? undefined : 'Нужен netconvert, он есть только в настольном приложении'}>
          <strong>SUMO, .net.xml</strong><span>Сеть через netconvert с теми же настройками, что и в Микро</span>
        </button>
        <button role="menuitem" onClick={() => pick('matsim')}>
          <strong>MATSim, network.xml</strong><span>Узлы и линки с пропускной способностью по СП</span>
        </button>
        <button role="menuitem" onClick={() => pick('report')}>
          <strong>Отчёт, HTML</strong><span>Показатели, карта и графики в одном файле, из браузера печатается в PDF</span>
        </button>
      </div>
    </details>
  );
}
