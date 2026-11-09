import type { ReactNode } from 'react';

/** Collapsible block of the inspector with a tracked-caps label. */
export function Section({ title, children, open = true, aside }: { title: string; children: ReactNode; open?: boolean; aside?: ReactNode }) {
  return (
    <details className="section" open={open}>
      <summary><span className="micro">{title}</span>{aside}</summary>
      <div className="section-body">{children}</div>
    </details>
  );
}
