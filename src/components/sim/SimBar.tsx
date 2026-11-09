import { useEffect } from 'react';
import { runSimulation, simEnd, SPEEDS, useSim } from '../../sim/store';
import { Icon } from '../icons';

const MINUTES = [5, 10, 15, 20] as const;

const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Advances model time while playing; stops at the end of the run. */
function usePlayback(): void {
  const playing = useSim((s) => s.playing);
  useEffect(() => {
    if (!playing) return undefined;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const { time, speed, result } = useSim.getState();
      const end = simEnd(result);
      const next = time + ((now - last) / 1000) * speed;
      last = now;
      if (next >= end) { useSim.setState({ time: end, playing: false }); return; }
      useSim.setState({ time: next });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
}

/** Floating transport bar of the micro level: run, play, pause, step, stop, speed, clock. */
export function SimBar() {
  usePlayback();
  const s = useSim();
  const end = simEnd(s.result);
  return (
    <div className="float sim-bar" role="toolbar" aria-label="Симуляция">
      <div className="sim-group">
      <select value={s.minutes} onChange={(e) => s.setMinutes(Number(e.target.value))} aria-label="Длительность модели" disabled={s.running}>
        {MINUTES.map((m) => <option key={m} value={m}>{m} мин</option>)}
      </select>
      <select value={s.demand} onChange={(e) => s.setDemand(e.target.value as 'random' | 'od')} aria-label="Спрос" disabled={s.running}
        title="Откуда брать поездки: случайные по всей сети или матрица корреспонденций из макромодели">
        <option value="random">Случайный спрос</option>
        <option value="od">Из макромодели</option>
      </select>
      <button className="btn btn-ink" onClick={() => void runSimulation()} disabled={s.running}>{s.running ? 'Считаю…' : s.result ? 'Пересчитать' : 'Запустить SUMO'}</button>
      </div>
      <div className="sim-group">
      <button className="tool" onClick={s.playing ? s.pause : s.play} disabled={!s.result} aria-label={s.playing ? 'Пауза' : 'Пуск'}>
        <Icon name={s.playing ? 'pause' : 'play'} />
      </button>
      <button className="tool" onClick={s.step} disabled={!s.result} aria-label="Шаг"><Icon name="step" /></button>
      <button className="tool" onClick={s.stop} disabled={!s.result} aria-label="Стоп"><Icon name="stop" /></button>
      <div className="seg" role="radiogroup" aria-label="Скорость">
        {SPEEDS.map((v) => <button key={v} role="radio" aria-checked={s.speed === v} className={s.speed === v ? 'on' : ''} onClick={() => s.setSpeed(v)}>{v}×</button>)}
      </div>
      <input type="range" min={0} max={end || 1} step={1} value={s.time} disabled={!s.result} onChange={(e) => s.seek(Number(e.target.value))} aria-label="Время модели" />
      <span className="mono sim-clock">{clock(s.time)} / {clock(end)}</span>
      </div>
    </div>
  );
}
