/** Mirrors `check::Report` on the Rust side. */
export type StageStatus = 'ok' | 'warn' | 'fail' | 'skipped';

export interface CheckStage {
  name: 'SUMO' | 'MATSim' | 'Webots';
  status: StageStatus;
  seconds: number;
  metrics: Array<[string, string]>;
  problems: string[];
  log_tail: string;
}

export interface CheckReport {
  work_dir: string;
  stages: CheckStage[];
}
