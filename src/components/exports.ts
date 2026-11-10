/** Exports of the graph into the formats the simulators read, and the HTML report; buttons are in the step «Сдача». */
import { toMatsimNetwork } from '../osm/matsim';
import { serializeOsm } from '../osm/serialize';
import { exportSumoNet, saveTextFile } from '../platform';
import { mapSnapshot } from '../map/instance';
import { useMacro } from '../macro/store';
import { buildReport } from '../report/report';
import { useScenarios } from '../scenarios/store';
import { useSim } from '../sim/store';
import { useEditor } from '../state/store';
import { wayLabel } from './sim/MicroPanel';

const stem = () => (useEditor.getState().saveName.trim() || 'graph').replace(/\.osm$/i, '');

export async function exportAs(kind: 'sumo' | 'matsim'): Promise<void> {
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

export async function exportReport(): Promise<void> {
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
