/** Mirrors `sim::SimResult` on the Rust side. */
export interface SimFrame {
  t: number;
  /** Six numbers per vehicle: id index, lon, lat, angle, speed m/s, type index. */
  v: number[];
}

export interface SimResult {
  frames: SimFrame[];
  types: string[];
  vehicles: number;
  finished: number;
  mean_duration_s: number;
  mean_time_loss_s: number;
  mean_waiting_s: number;
  mean_speed_kmh: number;
  traffic_lights: number;
  teleports: number;
  log_tail: string;
}

export const STRIDE = 6;
