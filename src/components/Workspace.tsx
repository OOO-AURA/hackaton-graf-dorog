import { useUi } from '../state/ui';
import { Ribbon } from './EmptyState';

const SOON: Readonly<Record<'macro' | 'micro', { title: string; text: string }>> = {
  macro: { title: 'Макро', text: 'Спрос и потоки по сети: кто куда едет и какие линки загружены. Уровень MATSim.' },
  micro: { title: 'Микро', text: 'Движение машин по полосам и светофорам на выбранном перекрёстке. Уровень SUMO и Webots.' },
};

/** Placeholder for the macro and micro levels; the map stays mounted underneath so nothing is lost on switch. */
export function WorkspaceSoon() {
  const workspace = useUi((s) => s.workspace);
  const setWorkspace = useUi((s) => s.setWorkspace);
  if (workspace === 'meso') return null;
  const s = SOON[workspace];
  return (
    <div className="soon">
      <Ribbon className="soon-ribbon" />
      <div className="soon-card">
        <span className="stamp">скоро</span>
        <h2 className="display">{s.title}</h2>
        <p>{s.text}</p>
        <button className="btn btn-ink" onClick={() => setWorkspace('meso')}>Вернуться к графу</button>
      </div>
    </div>
  );
}
