import { armKey, armsAt, type Arm } from './lanes';
import type { OsmDoc } from './types';

/**
 * Phases of a traffic light as the engineer sets them: in each phase some approaches move, for
 * some only the left turn (a green arrow) or everything but it; then yellow and all-red before
 * the next phase. A phase may also be for pedestrians only, all cars standing. The cycle is the
 * sum of the phases. From these the plan is drawn as coloured bars and sent to SUMO as its own
 * tlLogic (see netinfo.py), and the green times can be worked out by Webster's method from the
 * flows of the macro model.
 */

/** How an approach moves in a phase: not at all, every turn (left giving way to oncoming), all but left, or the left arrow only. */
export type Move = 'off' | 'go' | 'noleft' | 'left';

export const MOVE_ORDER: readonly Move[] = ['off', 'go', 'noleft', 'left'];
export const MOVE_NAMES: Readonly<Record<Move, string>> = { off: 'стоят', go: 'едут во все стороны', noleft: 'прямо и направо', left: 'стрелка налево' };

export interface SignalPhase {
  readonly green: number;
  readonly yellow: number;
  readonly allRed: number;
  /** Move of every approach in this phase, by arm key; a missing one stands. */
  readonly moves: Readonly<Record<string, Move>>;
  /** Pedestrians only: all cars stand. */
  readonly ped?: boolean;
}

export const YELLOW = 3;
export const ALL_RED = 2;
/** Saturation flow of one lane, vehicles an hour of green (SP 396.1325800 / HCM base). */
export const SAT_FLOW = 1800;
/** Lost time of a phase: start-up delay and the end of yellow nobody uses, seconds. */
export const LOST_TIME = 4;
/** Walking speed for the pedestrian green, metres a second. */
export const PED_SPEED = 1.2;
export const MIN_GREEN = 5;

const cycleOf = (phases: readonly SignalPhase[]) => phases.reduce((s, p) => s + p.green + p.yellow + p.allRed, 0);
export { cycleOf };

/** Approaches of a junction with traffic coming in. */
export const approachesOf = (doc: OsmDoc, nodeId: string): Arm[] => armsAt(doc, nodeId).filter((a) => a.lanesIn > 0);

const angle = (a: number, b: number) => { const d = Math.abs(((a - b) % 360) + 360) % 360; return d > 180 ? 360 - d : d; };

/**
 * Approaches in pairs that face each other: each pair moves together. Roads within 45° of
 * straight across are a pair; one left over moves alone.
 */
export function axesOf(arms: readonly Arm[]): Arm[][] {
  const left = [...arms];
  const out: Arm[][] = [];
  while (left.length) {
    const a = left.shift()!;
    let best = -1;
    let bestDev = 45;
    left.forEach((b, i) => { const dev = Math.abs(180 - angle(a.bearing, b.bearing)); if (dev < bestDev) { bestDev = dev; best = i; } });
    out.push(best >= 0 ? [a, left.splice(best, 1)[0]] : [a]);
  }
  return out;
}

/** Phases a light starts with: each pair of facing approaches in turn, optionally a left arrow before each and a pedestrian phase at the end. */
export function defaultPhases(doc: OsmDoc, nodeId: string, opts: { leftArrow?: boolean; ped?: boolean; cycle?: number } = {}): SignalPhase[] {
  const arms = approachesOf(doc, nodeId);
  const axes = axesOf(arms);
  const phases: Array<{ moves: Record<string, Move>; ped?: boolean; weight: number }> = [];
  for (const axis of axes) {
    if (opts.leftArrow && axis.length > 1) phases.push({ moves: Object.fromEntries(axis.map((a) => [armKey(a), 'left' as Move])), weight: 0.35 });
    phases.push({ moves: Object.fromEntries(axis.map((a) => [armKey(a), (opts.leftArrow && axis.length > 1 ? 'noleft' : 'go') as Move])), weight: axis.reduce((s, a) => s + a.lanesIn, 0) });
  }
  if (opts.ped) phases.push({ moves: {}, ped: true, weight: 0 });
  const fixed = phases.length * (YELLOW + ALL_RED);
  const pedGreen = opts.ped ? 15 : 0;
  const share = Math.max(MIN_GREEN * phases.length, (opts.cycle ?? 90) - fixed - pedGreen);
  const total = phases.reduce((s, p) => s + p.weight, 0) || 1;
  return phases.map((p) => ({
    green: p.ped ? pedGreen : Math.max(MIN_GREEN, Math.round((share * p.weight) / total)),
    yellow: YELLOW, allRed: ALL_RED, moves: p.moves, ped: p.ped,
  }));
}

export type Light = 'green' | 'arrow' | 'yellow' | 'red';

/** What one approach shows over the cycle, as runs of colour from the start of the cycle. */
export function approachTimeline(phases: readonly SignalPhase[], key: string): Array<{ from: number; to: number; light: Light }> {
  const out: Array<{ from: number; to: number; light: Light }> = [];
  const push = (from: number, to: number, light: Light) => {
    if (to - from <= 0) return;
    const last = out[out.length - 1];
    if (last && last.light === light && Math.abs(last.to - from) < 1e-6) last.to = to; else out.push({ from, to, light });
  };
  let t = 0;
  phases.forEach((p, i) => {
    const move = p.ped ? 'off' : p.moves[key] ?? 'off';
    const next = phases[(i + 1) % phases.length];
    const nextMove = next.ped ? 'off' : next.moves[key] ?? 'off';
    const on: Light | null = move === 'off' ? null : move === 'left' ? 'arrow' : 'green';
    push(t, t + p.green, on ?? 'red');
    t += p.green;
    // A light that stays on into the next phase does not go through yellow.
    const keeps = on && nextMove !== 'off' && (nextMove === 'left') === (move === 'left');
    push(t, t + p.yellow, keeps ? on! : on ? 'yellow' : 'red');
    t += p.yellow;
    push(t, t + p.allRed, keeps ? on! : 'red');
    t += p.allRed;
  });
  return out;
}

/** Green seconds an approach gets in a cycle (the left arrow counted apart). */
export const greenOf = (phases: readonly SignalPhase[], key: string, arrow = false) =>
  phases.reduce((s, p) => s + (!p.ped && (arrow ? p.moves[key] === 'left' : p.moves[key] === 'go' || p.moves[key] === 'noleft') ? p.green : 0), 0);

/** Capacity of an approach, vehicles an hour: lanes × saturation flow × green share. */
export const approachCapacity = (phases: readonly SignalPhase[], arm: Arm, satFlow = SAT_FLOW) => {
  const cycle = cycleOf(phases) || 1;
  return arm.lanesIn * satFlow * (greenOf(phases, armKey(arm)) + greenOf(phases, armKey(arm), true) * 0.4) / cycle;
};

/**
 * Webster's optimal cycle C₀ = (1.5 L + 5) / (1 − Y), with L the lost time of all phases and Y
 * the sum of the critical flow ratios y = q / s of the phases; the green is shared in proportion
 * to y. `flow` gives vehicles an hour coming in along an approach. Null when there is no flow or
 * the junction is over capacity (Y ≥ 0.95).
 */
export function webster(phases: readonly SignalPhase[], arms: readonly Arm[], flow: (key: string) => number, satFlow = SAT_FLOW, lost = LOST_TIME):
  { cycle: number; phases: SignalPhase[]; y: number } | null {
  const car = phases.filter((p) => !p.ped);
  const ratio = (p: SignalPhase) => Math.max(0, ...arms.filter((a) => (p.moves[armKey(a)] ?? 'off') !== 'off').map((a) => flow(armKey(a)) / (satFlow * Math.max(1, a.lanesIn))));
  const ys = phases.map((p) => (p.ped ? 0 : ratio(p)));
  const Y = ys.reduce((s, v) => s + v, 0);
  if (Y <= 0 || Y >= 0.95 || !car.length) return null;
  const L = car.length * lost;
  const cycle = Math.min(150, Math.max(30, Math.round((1.5 * L + 5) / (1 - Y))));
  const fixed = phases.reduce((s, p) => s + p.yellow + p.allRed + (p.ped ? p.green : 0), 0);
  const effective = Math.max(MIN_GREEN * car.length, cycle - fixed);
  return {
    cycle, y: Y,
    phases: phases.map((p, i) => (p.ped ? p : { ...p, green: Math.max(MIN_GREEN, Math.round((effective * ys[i]) / Y)) })),
  };
}

/** Shortest green that lets people cross a road `width` metres wide: 7 s to start plus the walk. */
export const pedGreen = (width: number, speed = PED_SPEED) => Math.ceil(7 + width / speed);
