import { useMemo } from 'react';
import { bottlenecks, junctionCapacity, junctionLoad, ROLE_LABEL, type JunctionCapacity, type JunctionLoad } from '../osm/capacity';
import { compass } from '../osm/turns';
import { levelOfService, useSim } from '../sim/store';
import { LOS_COLORS, simSpan } from '../sim/overlay';
import type { SimResult } from '../sim/types';
import type { OsmDoc } from '../osm/types';
import { useEditor } from '../state/store';
import { useUi } from '../state/ui';
import { useSettledDoc } from '../state/settled';

/**
 * Capacity of junctions next to what the SUMO runs put through them: on the junction card for the
 * one being edited, and as a list of bottlenecks in the micro panel.
 */

const fmt = (v: number) => Math.round(v).toLocaleString('ru-RU');
const loadColor = (load: number) => (load >= 0.95 ? '#E5392A' : load >= 0.8 ? '#F09131' : load >= 0.6 ? '#F0BC2A' : '#3D9F47');

const runOf = (doc: OsmDoc, cap: JunctionCapacity, r: SimResult | null): JunctionLoad | null => (r ? junctionLoad(doc, cap, r.ways, simSpan(r)) : null);

function RunLine({ run, label }: { run: JunctionLoad; label: string }) {
  const los = levelOfService(run.delay);
  return (
    <p className="cap-run">
      <span className="micro">{label}</span>
      <span className="mono">{fmt(run.flow)} авт/ч</span>
      <b className="mono" style={{ color: loadColor(run.load) }}>{Math.round(run.load * 100)}%</b>
      <span className="mono">{run.delay.toFixed(0)} с</span>
      <i className="los-chip" style={{ background: LOS_COLORS[los] }}>{los}</i>
    </p>
  );
}

/** On the junction card: what the approaches can let in, and what the last runs put through. */
export function JunctionCapacitySection({ nodeId }: { nodeId: string }) {
  const doc = useSettledDoc();
  const result = useSim((s) => s.result);
  const baseline = useSim((s) => s.baseline);
  const cap = useMemo(() => junctionCapacity(doc, nodeId), [doc, nodeId]);
  if (!cap) return null;
  const now = runOf(doc, cap, result);
  const before = baseline && baseline !== result ? runOf(doc, cap, baseline) : null;
  return (
    <div className="jc-capacity">
      <div className="jc-cap-head"><span className="micro">Пропускная способность</span><b className="mono">≈ {fmt(cap.total)} авт/ч</b></div>
      <ul className="cap-list">
        {cap.approaches.map((a) => (
          <li key={`${a.arm.wayId}:${a.arm.step}`}>
            <span className="cap-name">{a.name} <em>{compass(a.arm.bearing)}</em></span>
            <span className="cap-role">{ROLE_LABEL[a.role]}</span>
            <span className="mono">{a.lanes} × {fmt(a.capacity / a.lanes)}</span>
          </li>
        ))}
      </ul>
      {now ? <RunLine run={now} label="Прогон" /> : <p className="jc-hint">Запустите SUMO во вкладке «Микро»: здесь появятся поток через перекрёсток, загрузка и задержка.</p>}
      {before && <RunLine run={before} label="Было" />}
    </div>
  );
}

/** In the micro panel: the fullest junctions of the run, with the baseline next to them. */
export function Bottlenecks({ result, baseline }: { result: SimResult; baseline: SimResult | null }) {
  const doc = useSettledDoc();
  const select = useEditor((s) => s.select);
  const flyTo = useUi((s) => s.flyTo);
  const rows = useMemo(() => bottlenecks(doc, result.ways, simSpan(result), 8), [doc, result]);
  if (!rows.length) return null;
  const name = (cap: JunctionCapacity) => [...new Set(cap.approaches.map((a) => a.name))].slice(0, 2).join(' × ');
  return (
    <div className="section-body">
      <span className="micro">Узкие места: загрузка перекрёстков</span>
      <ul className="bottlenecks">
        {rows.map(({ cap, run }) => {
          const before = baseline && baseline !== result ? runOf(doc, cap, baseline) : null;
          const n = doc.nodes[cap.nodeId];
          return (
            <li key={cap.nodeId}>
              <button className="link" onClick={() => { select({ type: 'node', id: cap.nodeId }); flyTo([n.lon - 0.001, n.lat - 0.0007, n.lon + 0.001, n.lat + 0.0007]); }}>{name(cap)}</button>
              <span className="mono">{fmt(run.flow)} / {fmt(cap.total)}</span>
              <b className="mono" style={{ color: loadColor(run.load) }}>{Math.round(run.load * 100)}%</b>
              {before && <span className={`mono ${run.load <= before.load ? 'good' : 'bad'}`}>{run.load <= before.load ? '−' : '+'}{Math.abs(Math.round((run.load - before.load) * 100))}</span>}
            </li>
          );
        })}
      </ul>
      <p className="hint">Поток за час через перекрёсток в прогоне против его пропускной способности по полосам и регулированию. От 85% начинаются очереди. Клик показывает перекрёсток.</p>
    </div>
  );
}
