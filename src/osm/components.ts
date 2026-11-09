import type { Arc } from './roads';

/** Weakly connected components (union-find). Returns component id per node. */
export function weakComponents(nodes: readonly string[], arcs: readonly Arc[]): Map<string, string> {
  const parent = new Map(nodes.map((n) => [n, n]));
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(x, root);
    return root;
  };
  arcs.forEach((a) => parent.set(find(a.from), find(a.to)));
  return new Map(nodes.map((n) => [n, find(n)]));
}

/** Strongly connected components (iterative Tarjan). Returns component index per node. */
export function strongComponents(nodes: readonly string[], arcs: readonly Arc[]): Map<string, number> {
  const adj = new Map<string, string[]>(nodes.map((n) => [n, []]));
  arcs.forEach((a) => adj.get(a.from)?.push(a.to));
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const comp = new Map<string, number>();
  let counter = 0;
  let compCount = 0;

  for (const start of nodes) {
    if (index.has(start)) continue;
    const work: Array<{ node: string; next: number }> = [{ node: start, next: 0 }];
    index.set(start, counter); low.set(start, counter); counter += 1;
    stack.push(start); onStack.add(start);
    while (work.length) {
      const frame = work[work.length - 1];
      const succ = adj.get(frame.node)!;
      if (frame.next < succ.length) {
        const w = succ[frame.next++];
        if (!index.has(w)) {
          index.set(w, counter); low.set(w, counter); counter += 1;
          stack.push(w); onStack.add(w);
          work.push({ node: w, next: 0 });
        } else if (onStack.has(w)) {
          low.set(frame.node, Math.min(low.get(frame.node)!, index.get(w)!));
        }
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1].node;
        low.set(parent, Math.min(low.get(parent)!, low.get(frame.node)!));
      }
      if (low.get(frame.node) === index.get(frame.node)) {
        let w: string;
        do { w = stack.pop()!; onStack.delete(w); comp.set(w, compCount); } while (w !== frame.node);
        compCount += 1;
      }
    }
  }
  return comp;
}

export function largestGroup<K>(assignment: Map<string, K>): K | undefined {
  const sizes = new Map<K, number>();
  assignment.forEach((c) => sizes.set(c, (sizes.get(c) ?? 0) + 1));
  return [...sizes].sort((a, b) => b[1] - a[1])[0]?.[0];
}
