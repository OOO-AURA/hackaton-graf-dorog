/**
 * How each level of the pipeline will read one road: the editor shows it next to the tags, so an
 * edit can be followed to MATSim, SUMO and Webots at once. Rules measured on the task fragment
 * with the organisers' programs (MATSim 2026.0 OsmNetworkReader, SUMO 1.28 netconvert, Webots R2025a):
 * lanes per direction are `lanes` on a one-way road, `lanes:forward`/`lanes:backward` or half of
 * `lanes` on a two-way road, 1 without tags; MATSim capacity is lanes × a per-lane value by class.
 */
import { simulatorSpeeds } from './speeds';
import { webotsElevation } from './structures';
import { direction } from './tags';
import type { Tags } from './types';

/** MATSim OsmNetworkReader capacity per lane, vehicles per hour (primary, secondary, residential, tertiary measured). */
const MATSIM_LANE_CAPACITY: Readonly<Record<string, number>> = {
  motorway: 2000, trunk: 2000, primary: 1500, secondary: 1000, tertiary: 600, unclassified: 600, residential: 600, living_street: 300,
};

const base = (highway = '') => highway.replace(/_link$/, '');
const int = (v: string | undefined) => { const n = Number.parseInt(v ?? '', 10); return Number.isFinite(n) && n > 0 ? n : null; };

/** Lanes in each direction, forward and backward along the way. */
export function lanesPerDirection(tags: Tags): { forward: number; backward: number } {
  const dir = direction(tags);
  const lanes = int(tags.lanes);
  if (dir !== 'both') {
    const n = lanes ?? 1;
    return dir === 'forward' ? { forward: n, backward: 0 } : { forward: 0, backward: n };
  }
  const f = int(tags['lanes:forward']);
  const b = int(tags['lanes:backward']);
  const half = lanes ? Math.max(1, Math.floor(lanes / 2)) : 1;
  return { forward: f ?? (b && lanes ? Math.max(1, lanes - b) : half), backward: b ?? (f && lanes ? Math.max(1, lanes - f) : half) };
}

export interface SimulatorView {
  /** null when MATSim does not import this class (service roads). */
  readonly matsim: { speed: number | null; lanes: string; capacity: number } | null;
  readonly sumo: { speed: number | null; lanes: string };
  /** Height of the road in the Webots scene, metres; null when Webots skips it. */
  readonly webots: number | null;
}

const lanesText = ({ forward, backward }: { forward: number; backward: number }) =>
  (forward && backward ? `${forward} + ${backward}` : `${forward || backward}`);

export function howSimulatorsRead(tags: Tags): SimulatorView {
  const speeds = simulatorSpeeds(tags);
  const lanes = lanesPerDirection(tags);
  const perLane = MATSIM_LANE_CAPACITY[base(tags.highway)];
  return {
    matsim: perLane === undefined ? null : { speed: speeds.matsim, lanes: lanesText(lanes), capacity: Math.max(lanes.forward, lanes.backward) * perLane },
    sumo: { speed: speeds.sumo, lanes: lanesText(lanes) },
    webots: webotsElevation(tags),
  };
}
