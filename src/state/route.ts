import { create } from 'zustand';
import { fastestRoute, type NoRoute, type Route } from '../macro/route';
import { useEditor } from './store';

interface RouteState {
  from: string | null;
  to: string | null;
  result: Route | NoRoute | null;
  setFrom: (nodeId: string) => void;
  setTo: (nodeId: string) => void;
  clear: () => void;
}

const solve = (from: string | null, to: string | null) => (from && to ? fastestRoute(useEditor.getState().doc, from, to) : null);

export const useRoute = create<RouteState>((set, get) => ({
  from: null,
  to: null,
  result: null,
  setFrom: (from) => set({ from, result: solve(from, get().to) }),
  setTo: (to) => set({ to, result: solve(get().from, to) }),
  clear: () => set({ from: null, to: null, result: null }),
}));

// Edits change the graph, so the route is recomputed on the new one.
useEditor.subscribe((s, prev) => {
  if (s.doc === prev.doc) return;
  const { from, to } = useRoute.getState();
  const gone = (id: string | null) => Boolean(id && !s.doc.nodes[id]);
  if (gone(from) || gone(to)) { useRoute.getState().clear(); return; }
  if (from && to) useRoute.setState({ result: solve(from, to) });
});
