import { useBundle } from '../macro/bundleStore';
import { useMacro } from '../macro/store';
import { currentSelection, useEditor } from '../state/store';
import { useSettledDoc } from '../state/settled';

const TOP_PAIRS = 8;

/** Flow bundle of the selected road, like Flow bundle in PTV Visum. */
export function BundleSection() {
  const result = useMacro((s) => s.result);
  const selection = useEditor((s) => currentSelection(s));
  const doc = useSettledDoc();
  const { bundle, error, show, clear } = useBundle();
  const wayId = selection?.type === 'way' ? selection.id : null;
  const way = wayId ? doc.ways[wayId] : null;
  const name = (id: string) => doc.ways[id]?.tags.name || doc.ways[id]?.tags.highway || `way ${id}`;

  return (
    <div className="bundle">
      <div className="bundle-head">
        <span className="micro">Пучок потоков</span>
        <button className="btn" disabled={!result || !wayId} onClick={() => wayId && show(wayId)}
          title={!result ? 'Сначала распределите потоки' : wayId ? '' : 'Выберите дорогу на карте'}>
          {way ? `Кто едет по: ${name(way.id)}` : 'Выберите дорогу на карте'}
        </button>
        {bundle && <button className="btn btn-quiet" onClick={clear}>Скрыть</button>}
      </div>
      {error && <p className="hint err">{error}</p>}
      {!bundle && !error && <p className="hint">Показывает, поездки из каких зон в какие проходят по выбранной дороге и по каким улицам они к ней подъезжают. Так видно, кого заденет правка этой дороги.</p>}
      {bundle && (
        <>
          <p className="hint">Через <strong>{name(bundle.wayId)}</strong> едет {Math.round(bundle.total)} поездок в час, {bundle.pairs.length} пар зон. На карте розовым показан их путь, толщина по числу поездок.</p>
          {bundle.pairs.length > 0 && (
            <table className="purposes">
              <thead><tr><th>Откуда → куда</th><th>Поездок/ч</th><th>Доля</th></tr></thead>
              <tbody>{bundle.pairs.slice(0, TOP_PAIRS).map((p) => (
                <tr key={`${p.from}-${p.to}`}><th>{p.from} → {p.to}</th><td className="mono">{Math.round(p.trips)}</td><td className="mono">{Math.round((p.trips / bundle.total) * 100)}%</td></tr>
              ))}</tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
