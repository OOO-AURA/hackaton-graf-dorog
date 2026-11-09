import { setWayTag, setWayTags } from '../osm/edit';
import type { OsmWay } from '../osm/types';
import { useEditor } from '../state/store';
import { deleteSelection } from '../state/actions';
import { TextField } from './fields';
import { TagTable } from './TagTable';
import { Section } from './Section';
import { Icon } from './icons';
import { BuildingHeightFields } from './HeightFields';

const KIND_LABELS: Readonly<Record<string, string>> = {
  yes: 'Здание', apartments: 'Жилой дом', house: 'Дом', residential: 'Жилое', commercial: 'Коммерческое', retail: 'Торговое',
  office: 'Офисное', industrial: 'Промышленное', school: 'Школа', university: 'Университет', kindergarten: 'Детский сад',
  garage: 'Гараж', garages: 'Гаражи', roof: 'Навес', church: 'Церковь', hospital: 'Больница', public: 'Общественное',
};

export function BuildingInspector({ way }: { way: OsmWay }) {
  const apply = useEditor((s) => s.apply);
  const t = way.tags;
  const address = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(', ');
  return (
    <div className="inspector">
      <header className="insp-head">
        <span className="micro">Здание</span>
        <h2 className="insp-title">{t.name || address || KIND_LABELS[t.building ?? ''] || 'Здание'}</h2>
        <span className="mono insp-id">way {way.id} · {way.refs.length - 1} углов</span>
      </header>
      <Section title="Высота">
        <BuildingHeightFields ids={[way.id]} tags={t} />
      </Section>
      <Section title="Свойства" open={false}>
        <TextField label="Название" value={t.name ?? ''} onCommit={(v) => apply((d) => setWayTag(d, way.id, 'name', v || null))} />
        <div className="row">
          <TextField label="Улица" value={t['addr:street'] ?? ''} onCommit={(v) => apply((d) => setWayTag(d, way.id, 'addr:street', v || null))} />
          <TextField label="Дом" value={t['addr:housenumber'] ?? ''} onCommit={(v) => apply((d) => setWayTag(d, way.id, 'addr:housenumber', v || null))} />
        </div>
      </Section>
      <Section title="Все теги OSM" open={false} aside={<span className="mono count">{Object.keys(t).length}</span>}>
        <TagTable tags={t} onChange={(tags) => apply((d) => setWayTags(d, way.id, tags))} />
      </Section>
      <div className="insp-foot">
        <button className="btn btn-danger" onClick={deleteSelection} title="Delete"><Icon name="trash" /> Удалить здание</button>
      </div>
    </div>
  );
}
