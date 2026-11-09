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

/** Saves any text file: a native dialog in the app, a download in the browser. Returns false on cancel. */
export async function saveTextFile(text: string, fileName: string, label: string, ext: string): Promise<boolean> {
  if (!isDesktop) { downloadText(text, fileName); return true; }
  const { save } = await import('@tauri-apps/plugin-dialog');
  const path = await save({ defaultPath: fileName, filters: [{ name: label, extensions: [ext] }] });
  if (!path) return false;
  await invoke('write_osm', { path, text });
  return true;
}

/** Builds a SUMO network with netconvert next to where the user chooses. Desktop only. */
export async function exportSumoNet(osmText: string, fileName: string): Promise<boolean> {
  const { save } = await import('@tauri-apps/plugin-dialog');
  const path = await save({ defaultPath: fileName, filters: [{ name: 'SUMO network', extensions: ['xml'] }] });
  if (!path) return false;
  await invoke('export_sumo', { path, text: osmText });
  return true;
}

export function downloadText(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: /\.html$/i.test(fileName) ? 'text/html' : 'application/xml' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = /\.[a-z0-9]+$/i.test(fileName) ? fileName : `${fileName}.osm`;
  a.click();
  URL.revokeObjectURL(url);
}

export const runServerCheck = (text: string) => invoke<CheckReport>('check_osm', { text });

/**
 * fetch-compatible function for map data downloads. In the desktop app it goes through Rust and the
 * system curl (no CORS, own User-Agent); in the browser it is plain fetch.
 */
export const mapDataFetch = async (url: string, init?: RequestInit): Promise<Response> => {
  if (!isDesktop) return fetch(url, init);
  const form = typeof init?.body === 'string' ? init.body : null;
  const reply = await invoke<{ status: number; body: string }>('http_request', { url, form });
  return new Response(reply.body, { status: reply.status });
};
