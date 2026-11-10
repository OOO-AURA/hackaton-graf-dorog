import { applyJunctionTemplate, junctionLanes, toggleLaneTurn, TURNS, classifyTurn, turnDelta, type Turn } from '../osm/lanes';
import type { OsmNode } from '../osm/types';
import { useEditor } from '../state/store';
import { Section } from './Section';

export const TURN_GLYPHS: Readonly<Record<Turn, string>> = {
  sharp_left: '↙', left: '←', slight_left: '↖', through: '↑', slight_right: '↗', right: '→', sharp_right: '↘', reverse: '↶',
};

const TURN_NAMES: Readonly<Record<Turn, string>> = {
  sharp_left: 'резко налево', left: 'налево', slight_left: 'плавно налево', through: 'прямо',
  slight_right: 'плавно направо', right: 'направо', sharp_right: 'резко направо', reverse: 'разворот',
};

/**
 * Where each lane coming into a junction may go: one row per approach, one column per lane from
 * left to right, a button per direction the junction offers. Written to turn:lanes.
 */
export function LaneTurnsSection({ node }: { node: OsmNode }) {
  const doc = useEditor((s) => s.doc);
  const apply = useEditor((s) => s.apply);
  const lanes = junctionLanes(doc, node.id);
  if (lanes.arms.length < 3 || !lanes.approaches.length) return null;
  return (
    <Section title="Полосы" aside={<span className="mono count">{lanes.approaches.length}</span>}>
      <p className="hint">Куда можно проехать с каждой полосы, полосы слева направо по ходу движения. На карте: тяните от красной точки въезда к синей точке выезда, клик по связи и Delete её убирает.</p>
      {lanes.approaches.map((a) => {
        const way = doc.ways[a.arm.wayId];
        const offered = TURNS.filter((t) => lanes.arms.some((to) => to !== a.arm && to.lanesOut > 0 && classifyTurn(turnDelta(a.arm, to)) === t));
        return (
          <div key={`${a.arm.wayId}:${a.arm.step}`} className="approach">
            <div className="approach-head">
              <span>{way.tags.name || way.tags.highway}</span>
              <span className={`approach-tag${a.explicit ? ' set' : ''}`}>{a.explicit ? 'задано' : 'как обычно'}</span>
            </div>
            <div className="approach-lanes">
              {a.turns.map((turns, lane) => (
                <div key={lane} className="lane-col" aria-label={`Полоса ${lane + 1}`}>
                  {offered.map((t) => (
                    <button
                      key={t} className={`turn-btn${turns.includes(t) ? ' on' : ''}`} aria-pressed={turns.includes(t)}
                      title={`Полоса ${lane + 1}: ${TURN_NAMES[t]}`}
                      onClick={() => apply((d) => toggleLaneTurn(d, node.id, a.arm, lane, t))}
                    >{TURN_GLYPHS[t]}</button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        );
      })}
      <div className="buttons">
        <button className="btn" onClick={() => apply((d) => applyJunctionTemplate(d, node.id, 'strict'))} title="Налево только с левой полосы, направо только с правой">Повороты с крайних</button>
        <button className="btn" onClick={() => apply((d) => applyJunctionTemplate(d, node.id, 'free'))}>Все направления</button>
        <button className="btn" onClick={() => apply((d) => applyJunctionTemplate(d, node.id, 'usual'))}>Как обычно</button>
      </div>
    </Section>
  );
}
