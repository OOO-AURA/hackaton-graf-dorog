import { armsAt, junctions, type Arm } from './lanes';
import { approachControl } from './signs';
import type { OsmDoc } from './types';

/**
 * Capacity of a junction: how many vehicles an hour its approaches can let in, by lanes and by
 * how each approach is controlled. Per lane, in vehicles an hour (typical values of HCM and
 * the Russian guidance ОДМ 218.2.020): a lane at a light lets in its saturation flow, 1800, for
 * the share of the cycle it has green (0.45 for two phases with losses); on the main road of a
 * priority junction a lane flows on at 1600; a lane that gives way gets the gaps in the main flow,
 * 450 (380 at a stop sign, where every car stops first); at a junction of equal roads (the
 * right-hand rule) every lane yields to the right and gets about 650.
 *
 * It is an estimate by lane counts and control, the same for every junction of its kind, not a
 * study of one light's phases; a SUMO run says what actually passed (see junctionLoad).
 */

export type ApproachRole = 'signal' | 'main' | 'give_way' | 'stop' | 'equal';

export const LANE_CAPACITY: Readonly<Record<ApproachRole, number>> = { signal: 810, main: 1600, give_way: 450, stop: 380, equal: 650 };

export const ROLE_LABEL: Readonly<Record<ApproachRole, string>> = {
  signal: 'светофор', main: 'главная', give_way: 'уступает', stop: 'стоп', equal: 'равнозначная',
};

export interface ApproachCapacity {
  readonly arm: Arm;
  readonly name: string;
  readonly lanes: number;
  readonly role: ApproachRole;
  /** Vehicles an hour. */
  readonly capacity: number;
}

export interface JunctionCapacity {
  readonly nodeId: string;
  readonly approaches: readonly ApproachCapacity[];
  /** Vehicles an hour through all approaches. */
  readonly total: number;
}

/** Yard driveways and the like: whoever leaves them gives way (ПДД 8.3). */
const isDriveway = (highway: string | undefined) => highway === 'service' || highway === 'living_street';

function roleOf(doc: OsmDoc, nodeId: string, arm: Arm, arms: readonly Arm[]): ApproachRole {
  const control = approachControl(doc, nodeId, arm);
  if (control === 'signal') return 'signal';
  if (control === 'stop') return 'stop';
  if (control === 'give_way') return 'give_way';
  const tags = doc.ways[arm.wayId].tags;
  // Someone else at the junction gives way, or this road is marked as the main one.
  const othersYield = arms.some((a) => a !== arm && ['give_way', 'stop'].includes(approachControl(doc, nodeId, a) ?? ''));
  if (tags.priority_road === 'designated' || othersYield) return 'main';
  // Another road here is the main one: this one gives way to it.
  if (arms.some((a) => doc.ways[a.wayId].tags.priority_road === 'designated')) return 'give_way';
  if (isDriveway(tags.highway) && arms.some((a) => !isDriveway(doc.ways[a.wayId].tags.highway))) return 'give_way';
  if (arms.some((a) => isDriveway(doc.ways[a.wayId].tags.highway)) && !isDriveway(tags.highway)) return 'main';
  return 'equal';
}

export function junctionCapacity(doc: OsmDoc, nodeId: string): JunctionCapacity | null {
  const arms = armsAt(doc, nodeId);
  if (arms.length < 3) return null;
  const approaches = arms.filter((a) => a.lanesIn > 0).map((arm): ApproachCapacity => {
    const role = roleOf(doc, nodeId, arm, arms);
    const w = doc.ways[arm.wayId];
    return { arm, name: w.tags.name || w.tags.highway || 'дорога', lanes: arm.lanesIn, role, capacity: arm.lanesIn * LANE_CAPACITY[role] };
  });
  return { nodeId, approaches, total: approaches.reduce((s, a) => s + a.capacity, 0) };
}

export interface WayFlow { readonly way: string; readonly entered: number; readonly delay_s: number }

export interface JunctionLoad {
  /** Vehicles an hour that went through the junction in the run. */
  readonly flow: number;
  /** Flow over capacity: about 0.85 and up is where queues start. */
  readonly load: number;
  /** Mean delay of the vehicles on its roads, seconds. */
  readonly delay: number;
}

/**
 * What a SUMO run put through a junction. Every vehicle passing it drives one road in and one out,
 * so half the vehicles counted on its roads went through; scaled to an hour from the run's span.
 */
export function junctionLoad(doc: OsmDoc, cap: JunctionCapacity, ways: readonly WayFlow[], spanS: number): JunctionLoad | null {
  const ids = new Set(armsAt(doc, cap.nodeId).map((a) => a.wayId));
  const stats = ways.filter((w) => ids.has(w.way) && w.entered > 0);
  if (!stats.length || spanS <= 0 || cap.total <= 0) return null;
  const entered = stats.reduce((s, w) => s + w.entered, 0);
  const flow = ((entered / 2) * 3600) / spanS;
  const delay = stats.reduce((s, w) => s + w.delay_s * w.entered, 0) / entered;
  return { flow, load: flow / cap.total, delay };
}

/** Junctions by how full the run left them, fullest first. */
export function bottlenecks(doc: OsmDoc, ways: readonly WayFlow[], spanS: number, limit: number): Array<{ cap: JunctionCapacity; run: JunctionLoad }> {
  const out: Array<{ cap: JunctionCapacity; run: JunctionLoad }> = [];
  for (const id of junctions(doc)) {
    const cap = junctionCapacity(doc, id);
    const run = cap && junctionLoad(doc, cap, ways, spanS);
    if (cap && run) out.push({ cap, run });
  }
  return out.sort((a, b) => b.run.load - a.run.load).slice(0, limit);
}
