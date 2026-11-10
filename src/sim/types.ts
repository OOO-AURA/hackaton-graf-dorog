/** Mirrors `sim::SimResult` on the Rust side. */
export interface SimFrame {
  t: number;
  /** Six numbers per vehicle: id index, lon, lat, angle, speed m/s, type index. */
  v: number[];
}

/** Micro statistics of one OSM way over the run. */
export interface WayStat {
  way: string;
  entered: number;
  speed_kmh: number;
  delay_s: number;
  waiting_s: number;
}

/** Traffic light: signal heads as [link index, lon, lat] and state changes as [time, state]. */
export interface Signal {
  id: string;
  lon: number;
  lat: number;
  heads: Array<[number, number, number]>;
  states: Array<[number, string]>;
}

/** Light random traffic, the evening rush hour, or trips from the macro model's OD matrix. */
export type DemandKind = 'random' | 'rush' | 'od';

export interface SimResult {
  frames: SimFrame[];
  types: string[];
  demand: DemandKind;
  trips: number;
  ways: WayStat[];
  signals: Signal[];
  vehicles: number;
  finished: number;
  mean_duration_s: number;
  mean_time_loss_s: number;
  mean_waiting_s: number;
  mean_speed_kmh: number;
  /** Bus routes that made it into the run, buses that finished their route and their mean speed. */
  transit_lines?: number;
  pt_finished?: number;
  pt_mean_speed_kmh?: number;
  /** Walking people when pedestrians were on: count, finished walks, mean time lost per walk. */
  persons?: number;
  ped_finished?: number;
  ped_mean_time_loss_s?: number;
  crossings?: Array<{ lon: number; lat: number; peds: number }>;
  /** Signal plans from the node inspector that SUMO used: OSM node, SUMO light, actual cycle. */
  plans?: Array<{ node: string; tls: string; cycle_s: number }>;
  /** Delay per vehicle by minute for the ways that lost the most time. */
  timeline?: { step_s: number; ways: Array<{ way: string; delay: number[] }> };
  traffic_lights: number;
  teleports: number;
  log_tail: string;
}

export const STRIDE = 6;
