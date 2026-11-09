import { openFile } from '../state/actions';
import { useUi } from '../state/ui';
import { openExample } from './fileActions';
import { Icon } from './icons';

const STEPS = ['Открыть .osm', 'Править граф', 'Проверить', 'Сохранить'] as const;

/** Five stacked colour bars swept diagonally, the cassette-label motif of the style. */
export function Ribbon({ className = '' }: { className?: string }) {
  return (
    <div className={`ribbon ${className}`} aria-hidden="true">
      <i style={{ background: 'var(--pink)' }} /><i style={{ background: 'var(--orange)' }} /><i style={{ background: 'var(--yellow)' }} />
      <i style={{ background: 'var(--green)' }} /><i style={{ background: 'var(--blue)' }} />
    </div>
  );
}

export function Petals({ size = 28 }: { size?: number }) {
  return (
    <span className="petals" style={{ width: size, height: size }} aria-hidden="true">
      <i style={{ background: 'var(--blue)' }} /><i style={{ background: 'var(--red)' }} /><i style={{ background: 'var(--green)' }} /><i style={{ background: 'var(--yellow)' }} />
    </span>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <div className="loading-bars" aria-hidden="true">
        <i style={{ background: 'var(--green)' }} /><i style={{ background: 'var(--yellow)' }} /><i style={{ background: 'var(--orange)' }} /><i style={{ background: 'var(--red)' }} />
      </div>
      <p className="micro">Читаю граф</p>
      <p className="mono">{label}</p>
    </div>
  );
}

export function EmptyState() {
  const loading = useUi((s) => s.loading);
  return (
    <div className="empty">
      <Ribbon className="empty-ribbon" />
      {loading ? <Loading label={loading} /> : (
        <div className="empty-card">
          <p className="micro">Иркутск · граф УДС · OSM</p>
          <h1 className="display">Граф<br />дорог</h1>
          <p className="empty-lead">Откройте фрагмент OpenStreetMap, поправьте дороги и перекрёстки и сохраните файл для MATSim, SUMO и Webots.</p>
          <div className="empty-actions">
            <button className="btn btn-ink btn-lg" onClick={() => void openFile()}><Icon name="open" /> Открыть .osm <kbd>⌘O</kbd></button>
            <button className="btn btn-lg" onClick={() => void openExample()}>Пример из задания</button>
          </div>
          <ol className="spec">
            {STEPS.map((s, i) => <li key={s}><span className="box" aria-hidden="true" />{String(i + 1).padStart(2, '0')} {s}</li>)}
          </ol>
          <span className="stamp">hack-team10</span>
        </div>
      )}
    </div>
  );
}
