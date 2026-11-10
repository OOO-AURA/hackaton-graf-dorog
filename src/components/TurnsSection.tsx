import { useMemo } from 'react';
import { armLabel, junctionTurns, restrictionsAt, setTurnAllowed, TURN_LABELS, type Turn } from '../osm/turns';
import { useEditor } from '../state/store';
import { Section } from './Section';
import { useSettledDoc } from '../state/settled';

const KIND_ARROW = { straight: '↑', left: '↰', right: '↱', uturn: '↶' } as const;

/**
 * Turn table of a junction, like Turns in PTV Visum: every movement allowed by one-way rules,
 * each can be forbidden. Bans are written as OSM `type=restriction` relations, which SUMO
 * netconvert applies when it builds the network.
 */
export function TurnsSection({ nodeId }: { nodeId: string }) {
  const doc = useSettledDoc();
  const apply = useEditor((s) => s.apply);
  const turns = useMemo(() => junctionTurns(doc, nodeId), [doc, nodeId]);
  const relations = restrictionsAt(doc, nodeId).length;
  const banned = turns.filter((t) => !t.allowed).length;
  const toggle = (t: Turn) => apply((d) => setTurnAllowed(d, nodeId, t.from, t.to, !t.allowed));
  const approaches = [...new Map(turns.map((t) => [t.from.key, t.from])).values()];

  return (
    <Section title="Повороты" aside={<span className="mono count">{banned ? `${banned} запр.` : turns.length}</span>}>
      <p className="hint">Снимите галочку, чтобы запретить манёвр. Запрет пишется отношением OSM <code>type=restriction</code>, его учитывает SUMO при сборке сети.</p>
      {approaches.map((from) => (
        <div key={from.key} className="turn-group">
          <span className="micro">Въезд: {armLabel(from)}</span>
          <ul className="turn-list">
            {turns.filter((t) => t.from.key === from.key).map((t) => (
              <li key={t.to.key} className={t.allowed ? '' : 'banned'}>
                <label>
                  <input type="checkbox" checked={t.allowed} onChange={() => toggle(t)} />
                  <span className="turn-arrow" aria-hidden="true">{KIND_ARROW[t.kind]}</span>
                  <span>{TURN_LABELS[t.kind]}</span>
                  <span className="turn-to">на {armLabel(t.to)}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {relations > 0 && <p className="hint">Отношений-запретов в узле: {relations}.</p>}
    </Section>
  );
}
