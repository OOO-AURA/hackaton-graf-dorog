import { openFile } from '../state/actions';
import { dropDraft, restoreDraft, useDraft } from '../state/draft';
import { useUi } from '../state/ui';
import { openExample } from './fileActions';
import { Icon } from './icons';
import { AreaMenu } from './AreaMenu';

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

function DraftOffer() {
  const d = useDraft((s) => s.found);
  if (!d) return null;
  const when = new Date(d.savedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  return (
    <div className="draft-offer" role="alert">
      <p><strong>Есть несохранённый черновик</strong> {d.fileName}, записан {when}, линий в графе: {d.ways}. Прошлый сеанс закрылся, не сохранив правки.</p>
      <div className="draft-actions">
        <button className="btn btn-ink" onClick={() => void restoreDraft()}>Восстановить</button>
        <button className="btn btn-quiet" onClick={() => void dropDraft()}>Удалить черновик</button>
      </div>
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
          <DraftOffer />
          <div className="empty-actions">
            <button className="btn btn-ink btn-lg" onClick={() => void openFile()}><Icon name="open" /> Открыть .osm <kbd>⌘O</kbd></button>
            <button className="btn btn-lg" onClick={() => void openExample()}>Пример из задания</button>
            <AreaMenu align="left" />
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
