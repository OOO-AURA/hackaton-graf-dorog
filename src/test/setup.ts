/**
 * Node 25+ defines a global `localStorage` that is empty unless Node runs with --localstorage-file,
 * and it hides the one jsdom provides. Tests that touch storage then fail on new Node only.
 * An in-memory Storage keeps the suite the same on every Node version.
 */
class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.has(key) ? this.data.get(key)! : null; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) { this.data.set(key, String(value)); }
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  let usable = false;
  try { usable = typeof globalThis[name]?.getItem === 'function'; } catch { usable = false; }
  if (!usable) Object.defineProperty(globalThis, name, { value: new MemoryStorage(), configurable: true, writable: true });
}
