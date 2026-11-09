import { useUi } from '../state/ui';
import { Ribbon } from './EmptyState';

const SOON = { title: 'Микро', text: 'Движение машин по полосам и светофорам на выбранном перекрёстке. Уровень SUMO и Webots.' };

/** Placeholder for the micro level; the map stays mounted underneath so nothing is lost on switch. */
export function WorkspaceSoon() {
  const workspace = useUi((s) => s.workspace);
  const setWorkspace = useUi((s) => s.setWorkspace);
  if (workspace !== 'micro') return null;
  const s = SOON;
  return (
    <div className="soon">
      <Ribbon className="soon-ribbon" />
      <div className="soon-card">
        <span className="stamp">скоро</span>
        <h2 className="display">{s.title}</h2>
        <p>{s.text}</p>
        <button className="btn btn-ink" onClick={() => setWorkspace('macro')}>Вернуться к графу</button>
      </div>
    </div>
  );
}
