import { useEditor } from '../state/store';
import { placeRuleSigns } from '../osm/signs';

/** Cross-section thumbnail of a road template: lanes, markings, sidewalks or rails. */
export function Profile({ tags }: { tags: Record<string, string> }) {
  const W = 72; const H = 26;
  if (tags.railway) {
    const metro = tags.railway === 'subway';
    return (
      <svg className="tpl-profile" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        <rect x="8" y="6" width={W - 16} height="14" rx="2" fill={metro ? '#3B3F6B' : '#5B4A3C'} />
        {[14, 22, 30, 38, 46, 54, 62].map((x) => <rect key={x} x={x - 2} y="7" width="3" height="12" fill="#8A7766" />)}
        <rect x="8" y="9" width={W - 16} height="1.6" fill="#D9D4CC" /><rect x="8" y="15.4" width={W - 16} height="1.6" fill="#D9D4CC" />
      </svg>
    );
  }
  const hw = tags.highway ?? '';
  if (hw === 'steps') {
    return (
      <svg className="tpl-profile" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map((k) => <rect key={k} x={22 + k * 5} y="7" width="4" height="12" fill={k % 2 ? '#8C8478' : '#A39B8F'} />)}
      </svg>
    );
  }
  if (hw === 'footway' || hw === 'pedestrian' || hw === 'cycleway') {
    const color = hw === 'cycleway' ? '#3D7A52' : '#8C8478';
    return (
      <svg className="tpl-profile" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        <rect x={hw === 'pedestrian' ? 6 : 22} y="7" width={hw === 'pedestrian' ? W - 12 : W - 44} height="12" rx="2" fill={color} />
        {hw === 'cycleway' && <path d={`M36 8 V18`} stroke="#fff" strokeWidth="1" strokeDasharray="2 2" />}
      </svg>
    );
  }
  const lanes = Math.max(1, Number(tags.lanes ?? (hw === 'service' || hw === 'living_street' ? 1 : 2)));
  const oneway = tags.oneway === 'yes';
  const lw = Math.min(10, (W - 16) / lanes);
  const total = lw * lanes; const x0 = (W - total) / 2;
  const half = oneway ? lanes : Math.ceil(lanes / 2);
  return (
    <svg className="tpl-profile" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <rect x={x0 - 5} y="5" width="4" height="16" fill="#9B9286" /><rect x={x0 + total + 1} y="5" width="4" height="16" fill="#9B9286" />
      <rect x={x0} y="5" width={total} height="16" fill="#3A3A3E" />
      {Array.from({ length: lanes - 1 }, (_, k) => {
        const x = x0 + lw * (k + 1);
        const centre = !oneway && k + 1 === half;
        return centre
          ? <g key={k}><rect x={x - 1.2} y="5" width="0.9" height="16" fill={YELLOW_LINE} /><rect x={x + 0.3} y="5" width="0.9" height="16" fill={YELLOW_LINE} /></g>
          : <path key={k} d={`M${x} 5 V21`} stroke="#fff" strokeWidth="0.9" strokeDasharray="3 2.5" />;
      })}
      {Array.from({ length: lanes }, (_, k) => {
        const cx = x0 + lw * (k + 0.5); const up = oneway || k >= half;
        return <path key={k} d={up ? `M${cx - 2} 14 L${cx} 10 L${cx + 2} 14` : `M${cx - 2} 12 L${cx} 16 L${cx + 2} 12`} stroke="#fff" strokeOpacity="0.75" strokeWidth="1" fill="none" />;
      })}
    </svg>
  );
}

const YELLOW_LINE = '#F6C31B';

export const gabarit = (tags: Record<string, string>) => {
  if (tags.railway) return tags.railway === 'subway' ? 'тоннель · 1520 мм' : `колея ${tags.gauge ?? '1520'} мм`;
  const hw = tags.highway ?? '';
  if (hw === 'footway' || hw === 'pedestrian') return 'ширина 2,25 м';
  if (hw === 'steps') return 'ступени';
  if (hw === 'cycleway') return 'ширина 1,5 м';
  const lanes = Number(tags.lanes ?? 1);
  return `${lanes} пол. · ${tags.maxspeed ?? '—'} км/ч`;
};

/** Places priority signs by the traffic rules on every junction without a light. */
export function RuleSigns() {
  const apply = useEditor((s) => s.apply);
  const notify = useEditor((s) => s.notify);
  const run = () => {
    let counts = { giveWay: 0, mainRoads: 0 };
    apply((d) => {
      const r = placeRuleSigns(d);
      counts = r;
      return r.doc;
    });
    notify(counts.giveWay || counts.mainRoads
      ? `Знаки по ПДД: «Уступи дорогу» на ${counts.giveWay} въездах, главная дорога на ${counts.mainRoads} участках`
      : 'Новых знаков не нужно: на перекрёстках уже есть светофоры или знаки, либо дороги равнозначны');
  };
  return (
    <button className="btn btn-sm rule-signs" onClick={run} title="На перекрёстках без светофора дороги старшего класса становятся главными, второстепенные въезды получают «Уступи дорогу». Равнозначные дороги не трогаются: там правило правой руки.">
      Расставить знаки по ПДД
    </button>
  );
}

