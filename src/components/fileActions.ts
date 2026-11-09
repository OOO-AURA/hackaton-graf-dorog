import { loadExample, loadXml } from '../state/actions';
import { useUi } from '../state/ui';

/**
 * Lets the loading screen paint before the synchronous parse blocks the main thread.
 * The timer is a fallback: animation frames do not fire while the window is hidden.
 */
const nextFrame = () => new Promise<void>((resolve) => {
  requestAnimationFrame(() => setTimeout(resolve, 0));
  setTimeout(resolve, 60);
});

async function withLoading(label: string, task: () => Promise<void> | void): Promise<void> {
  const { setLoading } = useUi.getState();
  setLoading(label);
  try {
    await nextFrame();
    await task();
  } finally {
    setLoading(null);
  }
}

export const openExample = () => withLoading('example.osm', loadExample);

export async function openBrowserFile(file: File | undefined): Promise<void> {
  if (!file) return;
  await withLoading(file.name, async () => loadXml(await file.text(), file.name));
}
