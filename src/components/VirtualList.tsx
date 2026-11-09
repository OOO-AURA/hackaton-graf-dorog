import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Scrolling list that mounts only the rows in view. Rows have a fixed height, so the list
 * keeps its scroll length with two spacers and needs no measuring per row.
 */
export function VirtualList<T>({ items, rowHeight, className, keyOf, render, overscan = 8 }: {
  items: readonly T[]; rowHeight: number; className: string; keyOf: (item: T) => string; render: (item: T) => ReactNode; overscan?: number;
}) {
  const ref = useRef<HTMLUListElement>(null);
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(rowHeight * 20);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => setHeight(el.clientHeight || rowHeight * 20);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [rowHeight]);
  const first = Math.max(0, Math.floor(top / rowHeight) - overscan);
  const last = Math.min(items.length, Math.ceil((top + height) / rowHeight) + overscan);
  return (
    <ul ref={ref} className={`${className} vlist`} onScroll={(e) => setTop(e.currentTarget.scrollTop)}
      style={{ paddingTop: first * rowHeight, paddingBottom: (items.length - last) * rowHeight }}>
      {items.slice(first, last).map((item) => <li key={keyOf(item)} style={{ height: rowHeight }}>{render(item)}</li>)}
    </ul>
  );
}
