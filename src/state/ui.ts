import { create } from 'zustand';

export type Theme = 'light' | 'dark';
export type ThemeChoice = Theme | 'system';
export type Workspace = 'macro' | 'micro';
export type BottomTab = 'issues' | 'check' | 'flows' | 'transit' | 'scenarios' | 'journal';
export type LayerId = 'roads' | 'junctions' | 'signals' | 'crossings' | 'bridges' | 'tunnels' | 'buildings' | 'tram' | 'signs' | 'transit' | 'changes';

export const LAYER_IDS: readonly LayerId[] = ['roads', 'junctions', 'signals', 'crossings', 'bridges', 'tunnels', 'buildings', 'tram', 'signs', 'transit', 'changes'];

/** Layers that start hidden: they are overlays for a particular task. */
const OFF_BY_DEFAULT: ReadonlySet<LayerId> = new Set(['transit', 'changes']);

const THEME_KEY = 'graf.theme';

function readThemeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

const systemDark = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;

export const resolveTheme = (choice: ThemeChoice): Theme => (choice === 'system' ? (systemDark() ? 'dark' : 'light') : choice);

/** A request for the map to move; `seq` changes on every request so repeats still fire. */
export interface FlyRequest { bounds: [number, number, number, number]; seq: number }

interface UiState {
  themeChoice: ThemeChoice;
  theme: Theme;
  workspace: Workspace;
  bottomTab: BottomTab;
  bottomOpen: boolean;
  layers: Record<LayerId, boolean>;
  /** Opacity of the basemap under the graph, 0..1 ("model / map" slider). */
  basemapOpacity: number;
  loading: string | null;
  /** Tilted camera with extruded buildings. */
  view3d: boolean;
  toggle3d: () => void;
  /** Traffic-control object the T tool places (id from map/features.ts). */
  featureKind: string;
  setFeatureKind: (id: string) => void;
  fly: FlyRequest | null;
  setThemeChoice: (choice: ThemeChoice) => void;
  syncSystemTheme: () => void;
  setWorkspace: (w: Workspace) => void;
  openBottom: (tab: BottomTab) => void;
  toggleBottom: () => void;
  toggleLayer: (id: LayerId) => void;
  setBasemapOpacity: (v: number) => void;
  setLoading: (label: string | null) => void;
  flyTo: (bounds: [number, number, number, number]) => void;
}

const initialChoice = readThemeChoice();

export const useUi = create<UiState>((set, get) => ({
  themeChoice: initialChoice,
  theme: resolveTheme(initialChoice),
  workspace: 'macro',
  bottomTab: 'issues',
  bottomOpen: true,
  layers: Object.fromEntries(LAYER_IDS.map((id) => [id, !OFF_BY_DEFAULT.has(id)])) as Record<LayerId, boolean>,
  basemapOpacity: 0.7,
  loading: null,
  view3d: false,
  toggle3d: () => set({ view3d: !get().view3d }),
  featureKind: 'signal',
  setFeatureKind: (featureKind) => set({ featureKind }),
  fly: null,
  setThemeChoice: (themeChoice) => {
    try {
      if (themeChoice === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, themeChoice);
    } catch { /* storage may be unavailable; the choice still applies for this session */ }
    set({ themeChoice, theme: resolveTheme(themeChoice) });
  },
  syncSystemTheme: () => set({ theme: resolveTheme(get().themeChoice) }),
  setWorkspace: (workspace) => set({ workspace }),
  openBottom: (bottomTab) => set({ bottomTab, bottomOpen: true }),
  toggleBottom: () => set({ bottomOpen: !get().bottomOpen }),
  toggleLayer: (id) => set({ layers: { ...get().layers, [id]: !get().layers[id] } }),
  setBasemapOpacity: (basemapOpacity) => set({ basemapOpacity }),
  setLoading: (loading) => set({ loading }),
  flyTo: (bounds) => set({ fly: { bounds, seq: (get().fly?.seq ?? 0) + 1 } }),
}));
