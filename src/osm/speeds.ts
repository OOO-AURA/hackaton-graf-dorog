/**
 * Speed limits the three simulators agree on.
 *
 * MATSim (OsmNetworkReader) and SUMO (netconvert) fill a missing or non-numeric `maxspeed` with
 * their own defaults per road class, and those defaults differ a lot. Measured on the task fragment
 * with the same programs the organisers run: a `secondary` road without maxspeed gets 30 km/h in
 * MATSim and 100 km/h in SUMO; `residential` gets 15 and 50; `maxspeed=RU:urban` is 60 in SUMO but
 * MATSim does not read it and uses 80 for `primary`. So one street drives at different speeds on the
 * levels of the pipeline. A numeric `maxspeed` written by the Russian traffic rules (ПДД 10.2:
 * 60 km/h in a settlement, 20 km/h in living zones and yards) makes all of them use the same value.
 */
import { isDrivable } from './tags';
import type { OsmDoc, Tags } from './types';

const baseClass = (highway = '') => highway.replace(/_link$/, '');

/** MATSim OsmNetworkReader highway defaults, km/h (secondary, residential, unclassified measured). */
const MATSIM_DEFAULT: Readonly<Record<string, number>> = {
  motorway: 120, motorway_link: 80, trunk: 80, trunk_link: 50, primary: 80, primary_link: 60,
  secondary: 30, secondary_link: 30, tertiary: 25, tertiary_link: 25, unclassified: 15, residential: 15, living_street: 10,
};

/** SUMO netconvert OSM typemap defaults, km/h (secondary, links, residential, unclassified, service measured). */
const SUMO_DEFAULT: Readonly<Record<string, number>> = {
  motorway: 160, motorway_link: 80, trunk: 100, trunk_link: 80, primary: 100, primary_link: 80,
  secondary: 100, secondary_link: 80, tertiary: 80, tertiary_link: 80, unclassified: 50, residential: 50, living_street: 10, service: 20, road: 50,
};

/** Zone values SUMO understands and MATSim ignores. */
const ZONE_SPEED: Readonly<Record<string, number>> = { 'RU:urban': 60, 'RU:rural': 90, 'RU:living_street': 20, 'RU:motorway': 110 };

const numeric = (v: string | undefined): number | null => {
  const n = Number.parseFloat(v ?? '');
  return Number.isFinite(n) && n > 0 && /^\d+(\.\d+)?$/.test((v ?? '').trim()) ? n : null;
};

export interface SimSpeeds { readonly matsim: number | null; readonly sumo: number | null }

/** Speeds the simulators will use for this road, km/h; null where they have no default (MATSim drops the class). */
export function simulatorSpeeds(tags: Tags): SimSpeeds {
  const n = numeric(tags.maxspeed);
  if (n !== null) return { matsim: n, sumo: n };
  const zone = ZONE_SPEED[tags.maxspeed ?? ''];
  const h = tags.highway ?? '';
  return { matsim: MATSIM_DEFAULT[h] ?? null, sumo: zone ?? SUMO_DEFAULT[h] ?? SUMO_DEFAULT[baseClass(h)] ?? null };
}

/** Legal speed by ПДД in a settlement and the zone it comes from. */
export function legalSpeed(tags: Tags): { kmh: number; zone: string } {
  const zone = tags.maxspeed && ZONE_SPEED[tags.maxspeed] ? tags.maxspeed : null;
  if (zone) return { kmh: ZONE_SPEED[zone], zone };
  const h = baseClass(tags.highway);
  if (h === 'living_street' || h === 'service') return { kmh: 20, zone: 'RU:living_street' };
  if (h === 'motorway') return { kmh: 110, zone: 'RU:motorway' };
  return { kmh: 60, zone: 'RU:urban' };
}

/** Numeric maxspeed by ПДД; the zone it came from is kept in `source:maxspeed`, as OSM recommends. */
export function legalSpeedTags(tags: Tags): Tags {
  if (numeric(tags.maxspeed) !== null) return tags;
  const { kmh, zone } = legalSpeed(tags);
  return { ...tags, maxspeed: String(kmh), 'source:maxspeed': tags['source:maxspeed'] ?? zone };
}

export interface SpeedMismatch {
  readonly wayId: string;
  readonly speeds: SimSpeeds;
  readonly legal: number;
}

/** Drivable roads where MATSim and SUMO will not use the same speed. */
export function speedMismatches(doc: OsmDoc): SpeedMismatch[] {
  return Object.values(doc.ways).filter((w) => isDrivable(w.tags) && numeric(w.tags.maxspeed) === null).map((w) => ({
    wayId: w.id, speeds: simulatorSpeeds(w.tags), legal: legalSpeed(w.tags).kmh,
  // MATSim does not import some classes at all (service roads): there only SUMO has to match the rules.
  })).filter((m) => (m.speeds.matsim !== null && m.speeds.matsim !== m.speeds.sumo) || m.speeds.sumo !== m.legal);
}

/** Writes the legal numeric speed on every road from the list, in one document change. */
export function applyLegalSpeeds(doc: OsmDoc, wayIds: readonly string[]): OsmDoc {
  const changed = wayIds.filter((id) => doc.ways[id]).map((id) => [id, { ...doc.ways[id], tags: legalSpeedTags(doc.ways[id].tags) }] as const);
  return changed.length ? { ...doc, ways: { ...doc.ways, ...Object.fromEntries(changed) } } : doc;
}
