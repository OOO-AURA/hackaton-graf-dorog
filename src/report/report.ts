import type { MacroResult } from '../macro/compute';
import { haversine } from '../osm/geo';
import type { OsmDoc } from '../osm/types';
import type { Scenario } from '../scenarios/store';
import { heatCell, LOS_COLORS } from '../sim/overlay';
import { levelOfService, series } from '../sim/store';
import type { SimResult } from '../sim/types';

export interface ReportInput {
  fileName: string;
  date: Date;
  doc: OsmDoc;
  macro: MacroResult | null;
  sim: SimResult | null;
  baseline: SimResult | null;
  scenarios: readonly Scenario[];
  mapImage: string | null;
  wayName: (id: string) => string;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
const fmt = (v: number, d = 0) => v.toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d });

function kpi(value: string, label: string, delta?: { v: number; good: boolean; d: number }): string {
  const tail = delta && Math.abs(delta.v) >= 10 ** -delta.d / 2
    ? `<span class="delta ${delta.good ? 'good' : 'bad'}">${delta.v > 0 ? '+' : '−'}${fmt(Math.abs(delta.v), delta.d)}</span>` : '';
  return `<div class="kpi"><b>${value}</b>${tail}<span>${esc(label)}</span></div>`;
}

const diff = (now: number, base: number | undefined, better: 'up' | 'down', d: number) =>
  base === undefined ? undefined : { v: now - base, good: better === 'up' ? now > base : now < base, d };

function barChart(bins: ReadonlyArray<{ from: number; share: number }>, mean: number): string {
  const W = 520; const H = 160; const l = 36; const b = 22; const t = 10;
  const max = Math.max(...bins.map((x) => x.share), 0.01);
  const bw = (W - l - 8) / Math.max(1, bins.length);
  const bars = bins.map((x, i) => {
    const h = ((H - b - t) * x.share) / max;
    return `<rect x="${(l + i * bw + 1).toFixed(1)}" y="${(H - b - h).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="#5B4636"/>`;
  }).join('');
  const mx = l + (mean / Math.max(1, bins.length)) * (W - l - 8);
  const ticks = [0, Math.round(bins.length / 2), bins.length].map((v, i) => `<text x="${l + (v / Math.max(1, bins.length)) * (W - l - 8)}" y="${H - 6}" text-anchor="${i === 2 ? 'end' : 'middle'}">${v}${i === 2 ? ' мин' : ''}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Распределение времени поездок">
    <line x1="${l}" x2="${W - 8}" y1="${H - b}" y2="${H - b}" stroke="#C9BBA6"/>${bars}
    <line x1="${mx}" x2="${mx}" y1="${t}" y2="${H - b}" stroke="#E54489" stroke-dasharray="4 3" stroke-width="1.5"/>
    <text x="${mx + 4}" y="${t + 8}" class="accent">среднее ${fmt(mean, 1)}</text>
    <text x="${l - 6}" y="${t + 8}" text-anchor="end">${Math.round(max * 100)}%</text>${ticks}</svg>`;
}

function lineChart(points: ReadonlyArray<{ t: number; y: number }>, label: string): string {
  if (points.length < 2) return '';
  const W = 520; const H = 140; const l = 36; const b = 22; const t = 10;
  const maxT = points[points.length - 1].t || 1;
  const maxY = Math.max(...points.map((p) => p.y), 1);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${(l + (p.t / maxT) * (W - l - 8)).toFixed(1)},${(H - b - ((H - b - t) * p.y) / maxY).toFixed(1)}`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(label)}">
    <line x1="${l}" x2="${W - 8}" y1="${H - b}" y2="${H - b}" stroke="#C9BBA6"/>
    <path d="${d}" fill="none" stroke="#1B110A" stroke-width="2"/>
    <text x="${l - 6}" y="${t + 8}" text-anchor="end">${fmt(maxY)}</text><text x="${l}" y="${H - 6}">0</text><text x="${W - 8}" y="${H - 6}" text-anchor="end">${fmt(maxT / 60)} мин</text></svg>`;
}

function heatTable(sim: SimResult, name: (id: string) => string): string {
  const tl = sim.timeline;
  if (!tl?.ways.length) return '';
  const rows = tl.ways.slice(0, 15);
  const cols = Math.max(...rows.map((r) => r.delay.length));
  const head = `<tr><th></th>${Array.from({ length: cols }, (_, i) => `<th>${i % 5 === 0 ? i : ''}</th>`).join('')}</tr>`;
  const body = rows.map((r) => `<tr><th>${esc(name(r.way))}</th>${Array.from({ length: cols }, (_, i) => {
    const d = r.delay[i] ?? 0;
    const c = heatCell(d);
    return `<td title="${fmt(d, 1)} с" style="background:${c?.color ?? '#F3ECE0'};opacity:${c ? c.opacity.toFixed(2) : 1}"></td>`;
  }).join('')}</tr>`).join('');
  return `<table class="heat">${head}${body}</table><p class="note">Средняя задержка машины на дороге по минутам модели, цвет по уровню обслуживания.</p>`;
}

function scenarioTable(list: readonly Scenario[]): string {
  if (list.length < 2) return '';
  const cell = (v: number | undefined, d: number) => (v === undefined ? '—' : fmt(v, d));
  const rows: Array<[string, (s: Scenario) => number | undefined, number]> = [
    ['Пробег, авт-км/ч', (s) => s.macro?.vkt, 0], ['Время в пути, авт-ч/ч', (s) => s.macro?.vht, 0], ['Перегружено дуг', (s) => s.macro?.overloaded, 0],
    ['Задержка, с на поездку', (s) => s.micro?.delay, 1], ['Скорость, км/ч', (s) => s.micro?.speed, 1], ['Ожидание, с', (s) => s.micro?.waiting, 1],
  ];
  return `<h2>Сценарии</h2><table class="grid"><tr><th></th>${list.map((s) => `<th>${esc(s.name)}</th>`).join('')}</tr>${rows.map(([label, get, d]) => `<tr><th>${label}</th>${list.map((s) => `<td>${cell(get(s), d)}</td>`).join('')}</tr>`).join('')}</table>`;
}

/** Road ways, their junction-graph nodes and total centreline length. */
export function docStats(doc: OsmDoc): { ways: number; nodes: number; km: number } {
  const nodes = new Set<string>();
  let ways = 0; let m = 0;
  for (const w of Object.values(doc.ways)) {
    if (!w.tags.highway) continue;
    ways++;
    for (let i = 0; i < w.refs.length; i++) {
      nodes.add(w.refs[i]);
      const a = doc.nodes[w.refs[i - 1]]; const b = doc.nodes[w.refs[i]];
      if (i && a && b) m += haversine([a.lon, a.lat], [b.lon, b.lat]);
    }
  }
  return { ways, nodes: nodes.size, km: m / 1000 };
}

/** Self-contained HTML report for the jury: KPIs, map, charts. Prints to PDF from any browser. */
export function buildReport(r: ReportInput): string {
  const { macro, sim, baseline } = r;
  const b = baseline && baseline !== sim ? baseline : null;
  const parts: string[] = [];
  const st = docStats(r.doc);
  parts.push(`<header><div class="kicker">Граф дорог · отчёт</div><h1>${esc(r.fileName)}</h1><p class="meta">${r.date.toLocaleString('ru-RU')} · ${fmt(st.ways)} дорог, ${fmt(st.nodes)} узлов, ${fmt(st.km, 1)} км</p></header>`);
  if (r.mapImage) parts.push(`<figure class="map"><img src="${r.mapImage}" alt="Карта сети"><figcaption>Карта в момент выгрузки отчёта</figcaption></figure>`);
  if (macro) {
    parts.push(`<h2>Макромодель</h2><div class="kpis">${[
      kpi(fmt(macro.vkt), 'авт-км в час'), kpi(fmt(macro.vht), 'авт-ч в час'), kpi(fmt(macro.overloaded), 'перегруженных дуг, V/C > 1'),
      kpi(`${fmt(macro.gap * 100, 2)}%`, 'зазор равновесия'), kpi(fmt(macro.meanTime, 1), 'средняя поездка, мин'), kpi(fmt(macro.beta, 3), 'β гравитационной модели'),
    ].join('')}</div>`);
    if (macro.purposes.length) parts.push(`<table class="grid"><tr><th>Цель</th><th>Поездок в час</th><th>Среднее время, мин</th></tr>${macro.purposes.map((p) => `<tr><th>${esc(p.label)}</th><td>${fmt(p.trips)}</td><td>${fmt(p.meanTime, 1)}</td></tr>`).join('')}</table>`);
    if (macro.histogram.length) parts.push(`<h3>Распределение времени поездок</h3>${barChart(macro.histogram, macro.meanTime)}`);
  }
  if (sim) {
    const los = levelOfService(sim.mean_time_loss_s);
    parts.push(`<h2>Микросимуляция SUMO</h2><p class="los"><span style="background:${LOS_COLORS[los]}">${los}</span> уровень обслуживания по HCM, средняя задержка ${fmt(sim.mean_time_loss_s, 1)} с на поездку${b ? ', разница с базовым прогоном рядом с числами' : ''}.</p><div class="kpis">${[
      kpi(fmt(sim.trips), 'поездок в спросе'), kpi(fmt(sim.vehicles), 'ТС выпущено', diff(sim.vehicles, b?.vehicles, 'up', 0)),
      kpi(fmt(sim.finished), 'доехало', diff(sim.finished, b?.finished, 'up', 0)), kpi(fmt(sim.mean_time_loss_s, 1), 'задержка, с', diff(sim.mean_time_loss_s, b?.mean_time_loss_s, 'down', 1)),
      kpi(fmt(sim.mean_speed_kmh, 1), 'скорость, км/ч', diff(sim.mean_speed_kmh, b?.mean_speed_kmh, 'up', 1)), kpi(fmt(sim.mean_waiting_s, 1), 'ожидание, с', diff(sim.mean_waiting_s, b?.mean_waiting_s, 'down', 1)),
      ...(sim.transit_lines ? [kpi(fmt(sim.transit_lines), 'маршрутов ОТ'), kpi(fmt(sim.pt_mean_speed_kmh ?? 0, 1), 'скорость автобусов, км/ч')] : []),
      ...(sim.persons ? [kpi(fmt(sim.persons), 'пешеходов'), kpi(fmt(sim.ped_mean_time_loss_s ?? 0, 1), 'задержка пешехода, с')] : []),
    ].join('')}</div>`);
    const s = series(sim);
    parts.push(`<h3>Машин в сети</h3>${lineChart(s.map((p) => ({ t: p.t, y: p.n })), 'Машин в сети')}`);
    parts.push(`<h3>Задержки по времени</h3>${heatTable(sim, r.wayName)}`);
  }
  parts.push(scenarioTable(r.scenarios));
  if (!macro && !sim) parts.push('<p class="note">Потоки и микросимуляция ещё не считались: в отчёте только сведения о графе.</p>');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Отчёт · ${esc(r.fileName)}</title><style>${CSS}</style></head><body><main>${parts.join('\n')}<footer>Чтобы получить PDF, откройте файл в браузере и выберите «Печать → Сохранить как PDF».</footer></main></body></html>`;
}

const CSS = `
:root { color-scheme: light; --ink: #1B110A; --muted: #6E5D4E; --line: #E2D7C5; --paper: #FBF6EA; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 14px/1.45 -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 880px; margin: 0 auto; padding: 32px 16px 48px; }
.kicker { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); font-weight: 700; }
h1 { font-size: 34px; margin: 4px 0; line-height: 1.1; }
h2 { font-size: 20px; margin: 32px 0 10px; padding-top: 12px; border-top: 2px solid var(--ink); }
h3 { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin: 18px 0 6px; }
.meta, .note, footer, figcaption { color: var(--muted); font-size: 12.5px; }
.map { margin: 18px 0; } .map img { width: 100%; max-height: 520px; object-fit: cover; border: 1px solid var(--line); border-radius: 8px; display: block; }
.kpis { display: grid; grid-template-columns: repeat(3, 1fr); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.kpi { padding: 10px 12px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); display: grid; gap: 2px; }
.kpi b { font-size: 24px; font-variant-numeric: tabular-nums; }
.kpi span { font-size: 11.5px; color: var(--muted); }
.delta { font-size: 12px !important; font-weight: 600; } .good { color: #2F7D38 !important; } .bad { color: #C0392B !important; }
.los span { display: inline-block; min-width: 28px; text-align: center; font-weight: 800; border-radius: 4px; padding: 0 6px; margin-right: 6px; color: #1B110A; }
.chart { width: 100%; max-width: 520px; height: auto; display: block; } .chart text { font-size: 10px; fill: var(--muted); } .chart .accent { fill: #C2306F; }
@media (max-width: 560px) { .kpis { grid-template-columns: repeat(2, 1fr); } }
table { border-collapse: collapse; margin: 8px 0; font-variant-numeric: tabular-nums; }
.grid th, .grid td { padding: 5px 10px; border-bottom: 1px solid var(--line); text-align: right; } .grid th:first-child { text-align: left; font-weight: 500; }
.heat { width: 100%; table-layout: fixed; } .heat th { font-size: 10px; font-weight: 500; color: var(--muted); text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.heat tr th:first-child { width: 34%; } .heat td { height: 14px; border: 1px solid var(--paper); }
footer { margin-top: 40px; }
@media print { body { background: #fff; } main { padding: 0; } h2 { break-after: avoid; } .map, table, .kpis, .chart { break-inside: avoid; } footer { display: none; } }
`;
