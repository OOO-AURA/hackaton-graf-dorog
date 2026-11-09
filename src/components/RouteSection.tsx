import { useRoute } from '../state/route';
import { Section } from './Section';

const SECONDS_PER_MINUTE = 60;

/** Route from and to the selected node: a quick check that traffic can get through. */
export function RouteSection({ nodeId }: { nodeId: string }) {
  const { from, to, result, setFrom, setTo, clear } = useRoute();
  return (
    <Section title="Маршрут" open={Boolean(from || to)}>
      <div className="buttons">
        <button className={`btn btn-sm${from === nodeId ? ' btn-ink' : ''}`} onClick={() => setFrom(nodeId)}>Отсюда</button>
        <button className={`btn btn-sm${to === nodeId ? ' btn-ink' : ''}`} onClick={() => setTo(nodeId)}>Сюда</button>
        {(from || to) && <button className="btn btn-sm btn-quiet" onClick={clear}>Сбросить</button>}
      </div>
      {!result && <p className="hint">Выберите «Отсюда» в одном узле и «Сюда» в другом. Если проехать нельзя, сеть разрезана направлениями или разорванным перекрёстком, и агенты MATSim здесь тоже не проедут.</p>}
      {result?.found && (
        <p className="hint">{(result.lengthM / 1000).toFixed(2)} км, {(result.timeS / SECONDS_PER_MINUTE).toFixed(1)} мин без пробок{result.streets.length ? ` · ${result.streets.join(' → ')}` : ''}. Путь показан на карте.</p>
      )}
      {result && !result.found && (
        <p className="hint warn">{result.reason === 'not-on-graph'
          ? 'Узел не лежит на проезжей дороге.'
          : `Проехать нельзя: из начальной точки достижимо только ${result.reachableNodes} узлов графа. Проверьте односторонние участки и перекрёстки по пути.`}</p>
      )}
    </Section>
  );
}
