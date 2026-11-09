import { useEffect } from 'react';
import { isDesktop } from '../platform';
import { isDirty, useEditor } from './store';

const QUESTION = 'В графе есть несохранённые правки. Закрыть без сохранения?';

/** Asks before closing the window while there are unsaved edits (native dialog in the app, browser prompt on the web). */
export function useCloseGuard(): void {
  useEffect(() => {
    if (!isDesktop) {
      const onBeforeUnload = (e: BeforeUnloadEvent) => {
        if (!isDirty(useEditor.getState())) return;
        e.preventDefault();
        e.returnValue = '';
      };
      window.addEventListener('beforeunload', onBeforeUnload);
      return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void (async () => {
      const [{ getCurrentWindow }, { ask }] = await Promise.all([import('@tauri-apps/api/window'), import('@tauri-apps/plugin-dialog')]);
      const stop = await getCurrentWindow().onCloseRequested(async (event) => {
        if (!isDirty(useEditor.getState())) return;
        const close = await ask(QUESTION, { title: 'Граф дорог', kind: 'warning', okLabel: 'Закрыть', cancelLabel: 'Остаться' });
        if (!close) event.preventDefault();
      });
      const [{ listen }, { invoke }] = await Promise.all([import('@tauri-apps/api/event'), import('@tauri-apps/api/core')]);
      const stopQuit = await listen('quit-requested', async () => {
        if (isDirty(useEditor.getState()) && !(await ask(QUESTION, { title: 'Граф дорог', kind: 'warning', okLabel: 'Выйти', cancelLabel: 'Остаться' }))) return;
        await invoke('quit_app');
      });
      const both = () => { stop(); stopQuit(); };
      if (disposed) both(); else unlisten = both;
    })();
    return () => { disposed = true; unlisten?.(); };
  }, []);
}
