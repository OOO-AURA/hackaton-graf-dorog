/**
 * Thin layer over the desktop shell. In the Tauri app files go through native
 * dialogs and the Rust side; in a plain browser the editor falls back to a file
 * input and a download, so `npm run dev` keeps working without Tauri.
 */
import type { CheckReport } from './check';

export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const OSM_FILTER = [{ name: 'OpenStreetMap', extensions: ['osm', 'xml'] }];

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: call } = await import('@tauri-apps/api/core');
  return call<T>(cmd, args);
}

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

export interface OpenedFile { text: string; name: string; path: string | null }

/** Native "Open" dialog. Returns null if the user cancels. */
export async function openOsmFile(): Promise<OpenedFile | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const path = await open({ multiple: false, directory: false, filters: OSM_FILTER });
  if (typeof path !== 'string') return null;
  return { text: await invoke<string>('read_osm', { path }), name: baseName(path), path };
}

/** Writes to `path`, or asks where to save when there is none. Returns the path used, or null on cancel. */
export async function saveOsmFile(text: string, suggestedName: string, path: string | null): Promise<string | null> {
  let target = path;
  if (!target) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    target = await save({ defaultPath: suggestedName, filters: OSM_FILTER });
    if (!target) return null;
    if (!/\.osm$/i.test(target)) target += '.osm';
  }
  await invoke('write_osm', { path: target, text });
  return target;
}

export { baseName };

export function downloadText(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/xml' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.endsWith('.osm') ? fileName : `${fileName}.osm`;
  a.click();
  URL.revokeObjectURL(url);
}

export const runServerCheck = (text: string) => invoke<CheckReport>('check_osm', { text });
