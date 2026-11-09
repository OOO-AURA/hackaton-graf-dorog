import { isDrivable } from '../osm/tags';
import { useEditor } from '../state/store';
import { Section } from './Section';
import { BuildingHeightFields, RoadLevelFields } from './HeightFields';

/** Several ways selected with a frame: their height is set for all of them at once. */
export function MultiInspector({ ids }: { ids: readonly string[] }) {
  const doc = useEditor((s) => s.doc);
  const selectMany = useEditor((s) => s.selectMany);
  const buildings = ids.filter((id) => doc.ways[id]?.tags.building);
  const roads = ids.filter((id) => doc.ways[id] && isDrivable(doc.ways[id].tags));
  return (
    <div className="inspector">
      <header className="insp-head">
        <span className="micro">Выбрано несколько</span>
        <h2 className="insp-title">{ids.length} объектов</h2>
        <span className="mono insp-id">{buildings.length} зданий · {roads.length} дорог</span>
      </header>
      {buildings.length > 0 && (
        <Section title={`Высота зданий · ${buildings.length}`}>
          <BuildingHeightFields ids={buildings} tags={doc.ways[buildings[0]].tags} />
        </Section>
      )}
      {roads.length > 0 && (
        <Section title={`Уровень дорог · ${roads.length}`}>
          <RoadLevelFields ids={roads} tags={doc.ways[roads[0]].tags} />
        </Section>
      )}
      <p className="hint">Рамка с Shift выбирает здания и дороги. Значения применяются ко всем сразу и отменяются одним Ctrl+Z.</p>
      <div className="buttons">
        {buildings.length > 0 && roads.length > 0 && <button className="btn" onClick={() => selectMany(buildings)}>Только здания</button>}
        {buildings.length > 0 && roads.length > 0 && <button className="btn" onClick={() => selectMany(roads)}>Только дороги</button>}
        <button className="btn" onClick={() => selectMany([])}>Снять выделение</button>
      </div>
    </div>
  );
}
