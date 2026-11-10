import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { armsAt, armKey, junctions, type Arm } from '../osm/lanes';
import { approachCrossing, approachSign, approachSpeed, setApproachSign, type ApproachSign } from '../osm/signs';
import { sectionOf, edgesOf, plainSection } from '../map/section';
import { junctionGeometry, junctionRadius, turnGroup, type LaneStyle, type TurnGroup } from '../map/lanesGeo';
import { TURN_COLORS } from '../map/junctionLayers';
import { turnArrowImage, ARROW_LENGTH } from '../map/turnArrows';
import { frame, offsetLine, slice, lengthOf, type V } from '../map/polyline';
import { wayPoints } from '../map/shift';
import { useEditor } from '../state/store';
import { useUi } from '../state/ui';
import { useSettledDoc } from '../state/settled';
import { connectLanes, removePickedLink } from '../state/laneActions';
import { JunctionCapacitySection } from './CapacityParts';
import { JunctionInfo, JunctionLanes, JunctionSignal, JunctionSigns, junctionName, SignGlyph } from './JunctionParts';
import { Icon } from './icons';
import type { OsmDoc } from '../osm/types';
import type { Turn } from '../osm/lanes';

/**
 * The junction editor: a window over the map with a large plan of one junction and only the roads
 * that meet there, cut off a little way out. On the plan lanes are joined by dragging from a lane
 * coming in (red) to a lane going out (blue), a movement is picked by a click and forbidden with
 * Delete, and a click on the sign of an approach changes it. Beside the plan the same settings as
 * in the inspector: lanes, signs, the traffic light, capacity. Opens on a double click on a
 * junction; Esc closes it.
 */

/** How much of every road the plan shows, metres from the junction centre. */
const REACH = 42;
const SIGN_ORDER: readonly ApproachSign[] = ['none', 'main', 'give_way', 'stop'];
const SIGN_NAMES: Readonly<Record<ApproachSign, string>> = { none: 'без знака', main: 'главная дорога', give_way: 'уступи дорогу', stop: 'STOP' };

type Tab = 'lanes' | 'signs' | 'signal' | 'capacity' | 'info';
const TABS: ReadonlyArray<readonly [Tab, string]> = [['lanes', 'Полосы'], ['signs', 'Знаки'], ['signal', 'Светофор'], ['capacity', 'Пропускная'], ['info', 'Сведения']];

const STYLE: LaneStyle = { load: () => null, color: () => '#fff' };

/** Image of a lane arrow as a data URL, drawn once per set of turns. */
const arrowUrls = new Map<string, string>();
function arrowUrl(icon: string): string | null {
  if (arrowUrls.has(icon)) return arrowUrls.get(icon)!;
  const groups = icon.replace(/^turn-arrow:/, '').split('-').filter((g): g is TurnGroup => ['left', 'through', 'right', 'uturn'].includes(g));
  const img = groups.length ? turnArrowImage(groups) : null;
  if (!img) return null;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')?.putImageData(img, 0, 0);
  const url = c.toDataURL();
  arrowUrls.set(icon, url);
  return url;
}

const path = (pts: readonly V[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join('');

/** Points of an arm in metres around the junction, from it outwards, up to REACH. */
function armLine(doc: OsmDoc, arm: Arm, f: ReturnType<typeof frame>, centre: V): V[] {
  const way = doc.ways[arm.wayId];
  const all = wayPoints(doc, way, f).map((p): V => [p[0] - centre[0], p[1] - centre[1]]);
  const pts = arm.step === 1 ? all.slice(arm.index) : all.slice(0, arm.index + 1).reverse();
  return slice(pts, 0, Math.min(REACH, lengthOf(pts)));
}

interface Plan {
  roads: Array<{ key: string; line: V[]; centre: number; width: number; dividers: Array<{ off: number; solid: boolean }>; r: number }>;
  core: V[];
  ends: Array<{ p: V; arm: string; lane: number; kind: 'in' | 'out' }>;
  links: Array<{ pts: V[]; from: string; lane: number; to: string; turn: string; group: string }>;
  stops: Array<{ pts: V[]; kind: string }>;
  arrows: Array<{ p: V; icon: string; bearing: number }>;
  signs: Array<{ p: V; arm: Arm; sign: ApproachSign; speed: number | null; crossing: boolean }>;
  signal: boolean;
}

/** Everything drawn on the plan, in metres with y north and the junction at 0, 0. */
function planOf(doc: OsmDoc, nodeId: string): Plan {
  const node = doc.nodes[nodeId];
  const f = frame(node.lat);
  const centre = f.to(node.lon, node.lat);
  const local = (c: number[]): V => { const p = f.to(c[0], c[1]); return [p[0] - centre[0], p[1] - centre[1]]; };
  const r = junctionRadius(doc, nodeId);
  const arms = armsAt(doc, nodeId);
  const roads = arms.map((arm) => {
    const tags = doc.ways[arm.wayId].tags;
    const sec = sectionOf(tags);
    const e = edgesOf(sec);
    // Offsets are to the left of the way; along an arm against the way that is its right.
    const [left, right] = arm.step === 1 ? [e.left, e.right] : [e.right, e.left];
    return {
      key: armKey(arm), line: armLine(doc, arm, f, centre), centre: (left - right) / 2, width: left + right, r,
      dividers: plainSection(sec).dividers.map((m) => ({ off: m.offset * arm.step, solid: m.solid })),
    };
  });
  // The junction itself: the road edges where the arms leave it, joined into one shape.
  const corners: V[] = [];
  for (const road of roads) {
    const near = slice(road.line, 0, Math.min(road.r, lengthOf(road.line)));
    for (const off of [road.centre - road.width / 2, road.centre + road.width / 2]) corners.push(...offsetLine(near, off));
  }
  const g = junctionGeometry(doc, [nodeId], nodeId, STYLE);
  const signal = node.tags.highway === 'traffic_signals';
  const signs = arms.filter((a) => a.lanesIn > 0).map((arm) => {
    const road = roads[arms.indexOf(arm)];
    // On the right of traffic coming in, a little before the junction.
    const back = Math.min(r + 7, lengthOf(road.line) * 0.8);
    const pts = road.line;
    const at = slice(pts, 0, back).at(-1)!;
    const prev = slice(pts, 0, Math.max(0, back - 1)).at(-1)!;
    const dir: V = [at[0] - prev[0], at[1] - prev[1]];
    const len = Math.hypot(dir[0], dir[1]) || 1;
    // Coming in, traffic runs towards the junction: its right is the arm's left.
    const side = road.centre + road.width / 2 + 3;
    return { p: [at[0] - (dir[1] / len) * side, at[1] + (dir[0] / len) * side] as V, arm, sign: approachSign(doc, nodeId, arm), speed: approachSpeed(doc, arm), crossing: approachCrossing(doc, nodeId, arm) };
  });
  return {
    roads, core: hull(corners), signal, signs,
    ends: g.ends.features.map((x) => ({ p: local(x.geometry.coordinates), arm: String(x.properties.arm), lane: Number(x.properties.lane), kind: x.properties.kind as 'in' | 'out' })),
    links: g.links.features.map((x) => ({ pts: x.geometry.coordinates.map(local), from: String(x.properties.from), lane: Number(x.properties.lane), to: String(x.properties.to), turn: String(x.properties.turn), group: String(x.properties.group) })),
    stops: g.stops.features.map((x) => ({ pts: x.geometry.coordinates.map(local), kind: String(x.properties.kind) })),
    arrows: g.arrows.features.map((x) => ({ p: local(x.geometry.coordinates), icon: String(x.properties.icon), bearing: Number(x.properties.bearing) })),
  };
}

function hull(points: readonly V[]): V[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: V, a: V, b: V) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: V[]) => list.reduce<V[]>((out, p) => {
    while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
    return [...out, p];
  }, []);
  return [...half(pts).slice(0, -1), ...half([...pts].reverse()).slice(0, -1)];
}

/** The plan of the junction, drawn in metres: north up, the junction in the middle. */
function JunctionPlan({ nodeId }: { nodeId: string }) {
  const doc = useSettledDoc();
  const apply = useEditor((s) => s.apply);
  const picked = useUi((s) => s.laneLink);
  const setPicked = useUi((s) => s.setLaneLink);
  const plan = useMemo(() => planOf(doc, nodeId), [doc, nodeId]);
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ from: { arm: string; lane: number; p: V }; to: V } | null>(null);
  const toPlan = (e: { clientX: number; clientY: number }): V => {
    const el = svg.current;
    const m = el?.getScreenCTM();
    if (!el || !m) return [0, 0];
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [p.x, -p.y];
  };
  const onUp = (e: ReactPointerEvent) => {
    if (!drag) return;
    const at = toPlan(e);
    const target = plan.ends.filter((x) => x.kind === 'out').map((x) => ({ x, d: Math.hypot(x.p[0] - at[0], x.p[1] - at[1]) })).sort((a, b) => a.d - b.d)[0];
    if (target && target.d < 2.5) connectLanes(nodeId, drag.from.arm, drag.from.lane, target.x.arm);
    setDrag(null);
  };
  // Fitted to the roads drawn, so a junction of short or one-sided arms still fills the window.
  const view = useMemo(() => {
    const pts = plan.roads.flatMap((r) => r.line.flatMap((p) => [[p[0] - r.width / 2, p[1] - r.width / 2], [p[0] + r.width / 2, p[1] + r.width / 2]] as V[]));
    pts.push(...plan.signs.map((s) => s.p));
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => -p[1]);
    const pad = 4;
    const [x0, x1, y0, y1] = [Math.min(...xs) - pad, Math.max(...xs) + pad, Math.min(...ys) - pad, Math.max(...ys) + pad];
    return `${x0} ${y0} ${x1 - x0} ${y1 - y0}`;
  }, [plan]);
  const y = (p: V) => -p[1];
  const isPicked = (l: Plan['links'][number]) => Boolean(picked && picked.node === nodeId && picked.from === l.from && picked.lane === l.lane && picked.turn === l.turn);
  return (
    <svg
      ref={svg} className="jx-plan" viewBox={view} role="img" aria-label="Схема перекрёстка"
      onPointerMove={(e) => drag && setDrag({ ...drag, to: toPlan(e) })} onPointerUp={onUp} onPointerLeave={() => setDrag(null)}
      onClick={(e) => { if (e.target === svg.current) setPicked(null); }}
    >
      {plan.roads.map((road) => {
        const mid = offsetLine(road.line, road.centre).map((p): V => [p[0], y(p)]);
        return <path key={`c${road.key}`} d={path(mid)} className="jx-road-edge" strokeWidth={road.width + 0.6} />;
      })}
      <path d={`${path(plan.core.map((p): V => [p[0], y(p)]))}Z`} className="jx-core" />
      {plan.roads.map((road) => {
        const mid = offsetLine(road.line, road.centre).map((p): V => [p[0], y(p)]);
        return <path key={`r${road.key}`} d={path(mid)} className="jx-road" strokeWidth={road.width} />;
      })}
      {plan.roads.flatMap((road) => {
        const out = slice(road.line, Math.min(road.r, lengthOf(road.line)), lengthOf(road.line));
        if (out.length < 2) return [];
        return road.dividers.map((m, i) => (
          <path key={`d${road.key}${i}`} d={path(offsetLine(out, m.off).map((p): V => [p[0], y(p)]))} className={m.solid ? 'jx-mark' : 'jx-mark dash'} />
        ));
      })}
      {plan.stops.map((s, i) => <path key={`s${i}`} d={path(s.pts.map((p): V => [p[0], y(p)]))} className={`jx-stop ${s.kind}`} />)}
      {plan.arrows.map((a, i) => {
        const url = arrowUrl(a.icon);
        if (!url) return null;
        const h = ARROW_LENGTH + 0.2;
        const w = h * 0.5;
        return <image key={`a${i}`} href={url} x={-w / 2} y={-h / 2} width={w} height={h} transform={`translate(${a.p[0]} ${y(a.p)}) rotate(${a.bearing})`} />;
      })}
      {plan.links.map((l, i) => (
        <g key={`l${i}`} className={`jx-link${isPicked(l) ? ' picked' : ''}`} style={{ color: TURN_COLORS[turnGroup(l.turn as Turn)] }}
          onClick={(e) => { e.stopPropagation(); setPicked({ node: nodeId, from: l.from, lane: l.lane, to: l.to, turn: l.turn }); }}>
          <path d={path(l.pts.map((p): V => [p[0], y(p)]))} className="jx-link-hit" />
          <path d={path(l.pts.map((p): V => [p[0], y(p)]))} className="jx-link-line" />
          <title>Полоса {l.lane + 1}: клик выбирает манёвр, Delete запрещает его</title>
        </g>
      ))}
      {plan.ends.map((e, i) => (
        <circle key={`e${i}`} cx={e.p[0]} cy={y(e.p)} r={0.95} className={`jx-end ${e.kind}`}
          onPointerDown={(ev) => { if (e.kind !== 'in') return; ev.preventDefault(); (ev.target as Element).releasePointerCapture?.(ev.pointerId); setPicked(null); setDrag({ from: { arm: e.arm, lane: e.lane, p: e.p }, to: e.p }); }}>
          <title>{e.kind === 'in' ? `Въезд, полоса ${e.lane + 1}: тяните к синей точке выезда` : `Выезд, полоса ${e.lane + 1}`}</title>
        </circle>
      ))}
      {drag && <line x1={drag.from.p[0]} y1={y(drag.from.p)} x2={drag.to[0]} y2={y(drag.to)} className="jx-drag" />}
      {!plan.signal && plan.signs.map((s) => (
        <g key={`g${armKey(s.arm)}`} className="jx-sign" transform={`translate(${s.p[0] - 2.2} ${y(s.p) - 2.2})`}
          onClick={() => apply((d) => setApproachSign(d, nodeId, s.arm, SIGN_ORDER[(SIGN_ORDER.indexOf(s.sign) + 1) % SIGN_ORDER.length]))}>
          <rect width="4.4" height="4.4" rx="0.8" className="jx-sign-bg" />
          <svg x="0.4" y="0.4" width="3.6" height="3.6" viewBox="0 0 20 20" overflow="visible"><SignGlyph sign={s.sign} size={20} /></svg>
          <title>Знак: {SIGN_NAMES[s.sign]}. Клик меняет</title>
          {/* Under the priority sign the rest of the stack, as drivers see it: speed limit, crossing. */}
          {s.speed !== null && (
            <g transform="translate(0 4.8)"><circle cx="2.2" cy="2.2" r="2" fill="#fff" stroke="#D3302A" strokeWidth="0.5" />
              <text x="2.2" y="2.95" textAnchor="middle" fontSize="2" fontWeight="700" fill="#111" fontFamily="sans-serif">{s.speed}</text></g>
          )}
          {s.crossing && (
            <g transform={`translate(0 ${s.speed !== null ? 9.6 : 4.8})`}><rect width="4.4" height="4.4" rx="0.4" fill="#2A5DB0" />
              <path d="M0.7 3.7L2.2 0.7L3.7 3.7Z" fill="#fff" /><circle cx="2.2" cy="2" r="0.35" fill="#111" /></g>
          )}
        </g>
      ))}
      {plan.signal && (
        <g className="jx-signal" transform="translate(0 0)">
          <rect x="-1.4" y="-3.4" width="2.8" height="6.8" rx="0.8" />
          <circle cy="-2" r="0.75" fill="#E5392A" /><circle cy="0" r="0.75" fill="#F2C230" /><circle cy="2" r="0.75" fill="#3DBE6C" />
          <title>Светофор</title>
        </g>
      )}
    </svg>
  );
}

export function JunctionEditor() {
  const nodeId = useUi((s) => s.junctionEditor);
  const close = useUi((s) => s.setJunctionEditor);
  const doc = useSettledDoc();
  const [tab, setTab] = useState<Tab>('lanes');
  const viewOnly = useEditor((s) => s.mode === 'view');
  const open = Boolean(nodeId && doc.nodes[nodeId] && junctions(doc).includes(nodeId));
  useEffect(() => {
    if (!open) return undefined;
    // Before the map's own keys: Esc closes the window instead of dropping the selection.
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /input|textarea|select/i.test(target.tagName)) return;
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && useUi.getState().laneLink) { e.stopPropagation(); e.preventDefault(); removePickedLink(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, close]);
  if (!open || !nodeId) return null;
  return (
    <div className="jx-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) close(null); }}>
      <section className="jx-window" role="dialog" aria-modal="true" aria-label="Редактор перекрёстка">
        <header className="jx-head">
          <div>
            <span className="micro">Редактор перекрёстка</span>
            <h2>{junctionName(doc, nodeId)}</h2>
          </div>
          <button className="tool" onClick={() => close(null)} title="Закрыть (Esc)"><Icon name="close" /></button>
        </header>
        <div className="jx-body">
          <div className="jx-stage">
            <JunctionPlan nodeId={nodeId} />
            <p className="jx-help">Тяните от красной точки въезда к синей точке выезда, чтобы разрешить манёвр. Клик по ленте выбирает манёвр, Delete запрещает. Клик по знаку меняет его.</p>
          </div>
          <aside className="jx-side">
            <div className="seg seg-wide jc-tabs" role="tablist" aria-label="Разделы перекрёстка">
              {TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>)}
            </div>
            <fieldset className="jx-panel" disabled={viewOnly}>
              {tab === 'lanes' && <JunctionLanes nodeId={nodeId} />}
              {tab === 'signs' && <JunctionSigns nodeId={nodeId} />}
              {tab === 'signal' && <JunctionSignal nodeId={nodeId} />}
              {tab === 'capacity' && <JunctionCapacitySection nodeId={nodeId} />}
              {tab === 'info' && <JunctionInfo nodeId={nodeId} />}
            </fieldset>
          </aside>
        </div>
      </section>
    </div>
  );
}
