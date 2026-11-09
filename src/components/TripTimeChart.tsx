/** Share of trips by travel time on the loaded network, one bar per minute. */
export function TripTimeChart({ bins, mean }: { bins: ReadonlyArray<{ from: number; share: number }>; mean: number }) {
  if (!bins.length) return null;
  const W = 300;
  const H = 90;
  const pad = { l: 26, r: 6, t: 8, b: 18 };
  const max = Math.max(...bins.map((b) => b.share), 0.01);
  const span = bins.length;
  const bw = (W - pad.l - pad.r) / span;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const x = (minutes: number) => pad.l + (minutes / span) * (W - pad.l - pad.r);
  const ticks = [0, Math.round(span / 2), span];
  return (
    <figure className="chart trip-chart">
      <figcaption><span className="micro">Время поездки</span><span className="mono">среднее {mean.toFixed(1)} мин</span></figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Распределение времени поездок, среднее ${mean.toFixed(1)} мин`}>
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} className="axis" />
        <text x={pad.l - 4} y={y(max) + 3} className="tick" textAnchor="end">{Math.round(max * 100)}%</text>
        {bins.map((b, i) => (
          <rect key={b.from} x={pad.l + i * bw + 1} y={y(b.share)} width={Math.max(1, bw - 2)} height={H - pad.b - y(b.share)} rx={1.5} className="bar">
            <title>{`${b.from}–${b.from + 1} мин: ${(b.share * 100).toFixed(1)}%`}</title>
          </rect>
        ))}
        <line x1={x(mean)} x2={x(mean)} y1={pad.t} y2={H - pad.b} className="mean" />
        {ticks.map((t) => <text key={t} x={x(t)} y={H - 4} className="tick" textAnchor="middle">{t}</text>)}
        <text x={W - pad.r} y={H - 4} className="tick" textAnchor="end">мин</text>
      </svg>
    </figure>
  );
}
