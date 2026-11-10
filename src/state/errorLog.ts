import { create } from 'zustand';
import type { Issue } from '../osm/validate';

/**
 * The error log: everything that went wrong in a session, in order. Two kinds of entries: the
 * application's own failures (a download, the SUMO run, saving, an uncaught exception) and the
 * graph's errors, logged when an edit brings one in and marked fixed when an edit takes it away.
 */

export type LogKind = 'app' | 'graph';

export interface LogEntry {
  readonly id: number;
  readonly time: number;
  readonly kind: LogKind;
  readonly message: string;
  /** For graph errors: the validation issue and where it is. */
  readonly issueId?: string;
  readonly at?: readonly [number, number];
  /** When an edit fixed it. */
  readonly fixedAt?: number;
  /** A graph error that came with the file, not with an edit. */
  readonly fromFile?: boolean;
}

interface LogState {
  entries: LogEntry[];
  add: (kind: LogKind, message: string, extra?: Partial<Pick<LogEntry, 'issueId' | 'at'>>) => void;
  /** Brings the graph errors in line with a new validation report. */
  syncIssues: (issues: readonly Issue[], fromFile?: boolean) => void;
  clear: () => void;
}

/** The log keeps the last entries only: a long session does not grow it without end. */
const LOG_LIMIT = 500;
let nextId = 1;

export const useErrorLog = create<LogState>((set, get) => ({
  entries: [],
  add: (kind, message, extra) => set(({ entries }) => ({
    entries: [...entries, { id: nextId++, time: Date.now(), kind, message, ...extra }].slice(-LOG_LIMIT),
  })),
  syncIssues: (issues, fromFile = false) => {
    const errors = new Map(issues.filter((i) => i.severity === 'error').map((i) => [i.id, i]));
    const open = new Set(get().entries.filter((e) => e.kind === 'graph' && !e.fixedAt).map((e) => e.issueId));
    const now = Date.now();
    set(({ entries }) => ({
      entries: [
        ...entries.map((e) => (e.kind === 'graph' && !e.fixedAt && e.issueId && !errors.has(e.issueId) ? { ...e, fixedAt: now } : e)),
        ...[...errors.values()].filter((i) => !open.has(i.id)).map((i): LogEntry => ({ id: nextId++, time: now, kind: 'graph', message: i.message, issueId: i.id, at: i.at, fromFile })),
      ].slice(-LOG_LIMIT),
    }));
  },
  clear: () => set({ entries: [] }),
}));

const text = (v: unknown) => (v instanceof Error ? v.message : typeof v === 'string' ? v : (() => { try { return JSON.stringify(v); } catch { return String(v); } })());

/**
 * Catches the application's failures: errors written to the console by the editor's own code,
 * uncaught exceptions and rejected promises. Call once at start-up.
 */
export function startErrorLog(): () => void {
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    original(...args);
    useErrorLog.getState().add('app', args.map(text).join(' ').slice(0, 400));
  };
  const onError = (e: ErrorEvent) => useErrorLog.getState().add('app', `Сбой: ${e.message}`);
  const onRejection = (e: PromiseRejectionEvent) => useErrorLog.getState().add('app', `Сбой: ${text(e.reason)}`.slice(0, 400));
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    console.error = original;
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

/** The log as plain text, for saving next to a bug report. */
export function logText(entries: readonly LogEntry[]): string {
  const t = (ms: number) => new Date(ms).toLocaleTimeString('ru-RU');
  return entries.map((e) => `${t(e.time)}\t${e.kind === 'app' ? 'приложение' : e.fromFile ? 'граф, в файле' : 'граф, после правки'}\t${e.message}${e.fixedAt ? `\t(исправлено в ${t(e.fixedAt)})` : ''}`).join('\n');
}
