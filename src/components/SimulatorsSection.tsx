import { howSimulatorsRead } from '../osm/simulators';
import type { Tags } from '../osm/types';
import { Section } from './Section';

const kmh = (v: number | null) => (v === null ? '—' : `${v} км/ч`);

/**
 * How MATSim, SUMO and Webots will read this road, from its tags. Checked against the networks the
 * organisers' programs build from the task fragment, so an edit can be followed to all three levels.
 */
export function SimulatorsSection({ tags }: { tags: Tags }) {
  const v = howSimulatorsRead(tags);
  return (
    <Section title="Как прочитают симуляторы">
      <table className="sim-read">
        <thead><tr><th /><th>MATSim</th><th>SUMO</th><th>Webots</th></tr></thead>
        <tbody>
          <tr><th>Скорость</th><td>{v.matsim ? kmh(v.matsim.speed) : 'не импортирует'}</td><td>{kmh(v.sumo.speed)}</td><td rowSpan={3}>{v.webots === null ? 'не строит' : v.webots > 0 ? `на ${v.webots} м над землёй` : 'на земле'}</td></tr>
          <tr><th>Полос по направлениям</th><td>{v.matsim?.lanes ?? '—'}</td><td>{v.sumo.lanes}</td></tr>
          <tr><th>Пропускная, авт/ч</th><td>{v.matsim ? v.matsim.capacity : '—'}</td><td>по модели SUMO</td></tr>
        </tbody>
      </table>
      <p className="hint">Значения сверены с сетями, которые MATSim и SUMO строят из этого же файла. Если скорость в столбцах разная, укажите число в «Скорость, км/ч».</p>
    </Section>
  );
}
