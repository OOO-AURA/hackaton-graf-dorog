import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { VirtualList } from './VirtualList';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('VirtualList', () => {
  it('mounts only the rows in view and keeps the full scroll length', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    const items = Array.from({ length: 5000 }, (_, i) => `row ${i}`);
    act(() => root.render(<VirtualList className="list" items={items} rowHeight={25} keyOf={(s) => s} render={(s) => <span>{s}</span>} />));
    const ul = host.querySelector('ul')!;
    expect(ul.querySelectorAll('li').length).toBeLessThan(40);
    expect(ul.textContent).toContain('row 0');
    const pad = parseFloat(ul.style.paddingBottom);
    expect(pad + ul.querySelectorAll('li').length * 25).toBe(5000 * 25);
    act(() => { ul.scrollTop = 25 * 3000; ul.dispatchEvent(new Event('scroll')); });
    expect(ul.textContent).toContain('row 3000');
    expect(ul.textContent).not.toContain('row 0<');
    act(() => root.render(<VirtualList className="list" items={items.slice(0, 5)} rowHeight={25} keyOf={(s) => s} render={(s) => <span>{s}</span>} />));
    expect(ul.querySelectorAll('li').length).toBe(5);
    act(() => root.unmount());
  });
});
