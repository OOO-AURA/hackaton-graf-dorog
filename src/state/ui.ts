import { create } from 'zustand';
import type { RoadColorMode } from '../map/thematic';
import type { DrawTarget } from '../map/drawSnap';
import type { Lens } from '../map/lens';

export type Theme = 'light' | 'dark';
export type ThemeChoice = Theme | 'system';
export type Workspace = 'macro' | 'micro';
/** How roads look: coloured by class like a graph, or as asphalt with markings like an engineering plan. */
export type RoadLook = 'graph' | 'engineering';
export type BottomTab = 'issues' | 'check' | 'flows' | 'transit' | 'scenarios' | 'journal';
export type LayerId = 'roads' | 'sidewalks' | 'junctions' | 'signals' | 'crossings' | 'bridges' | 'tunnels' | 'buildings' | 'tram' | 'signs' | 'transit' | 'changes';

export const LAYER_IDS: readonly LayerId[] = ['roads', 'sidewalks', 'junctions', 'signals', 'crossings', 'bridges', 'tunnels', 'buildings', 'tram', 'signs', 'transit', 'changes'];

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

/** A link across a junction: from lane `lane` of the arm `from` (see armKey), taking `turn`. */
export interface LaneLinkRef { node: string; from: string; lane: number; to: string; turn: string }

/** A request for the map to move; `seq` changes on every request so repeats still fire. */
export interface FlyRequest { bounds: [number, number, number, number]; seq: number }

interface UiState {
  themeChoice: ThemeChoice;
  theme: Theme;
  workspace: Workspace;
  bottomTab: BottomTab;
  bottomOpen: boolean;
  layers: Record<LayerId, boolean>;
  /** Which traveller the map is looked at for (see map/lens.ts). */
  lens: Lens;
  setLens: (lens: Lens) => void;
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
  /** What the road colour shows: class (default) or one attribute, like a Visum classified display. */
  roadColorMode: RoadColorMode;
  setRoadColorMode: (mode: RoadColorMode) => void;
  roadLook: RoadLook;
  setRoadLook: (look: RoadLook) => void;
  /** A node is being dragged: costly map layers wait for it to be let go (see state/settled.ts). */
  dragging: boolean;
  setDragging: (dragging: boolean) => void;
  /** Where the next point of the road being drawn would go, snapped (see map/drawSnap.ts). */
  drawTarget: DrawTarget | null;
  setDrawTarget: (target: DrawTarget | null) => void;
  /** Curve mode: the click after a point bends the road (control point), the next one ends the curve. */
  drawCurve: boolean;
  toggleDrawCurve: () => void;
  curveControl: { lon: number; lat: number } | null;
  setCurveControl: (control: { lon: number; lat: number } | null) => void;
  /** Lane link picked on the map at the junction being edited; Delete forbids that turn. */
  laneLink: LaneLinkRef | null;
  setLaneLink: (link: LaneLinkRef | null) => void;
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
  laneLink: null,
  setLaneLink: (laneLink) => set({ laneLink }),
  themeChoice: initialChoice,
  theme: resolveTheme(initialChoice),
  workspace: 'macro',
  bottomTab: 'issues',
  bottomOpen: false,
  layers: Object.fromEntries(LAYER_IDS.map((id) => [id, !OFF_BY_DEFAULT.has(id)])) as Record<LayerId, boolean>,
  basemapOpacity: 0.7,
  loading: null,
  view3d: false,
  toggle3d: () => set({ view3d: !get().view3d }),
  featureKind: 'signal',
  setFeatureKind: (featureKind) => set({ featureKind }),
  fly: null,
  roadColorMode: 'class',
  setRoadColorMode: (roadColorMode) => set({ roadColorMode }),
  roadLook: 'engineering',
  setRoadLook: (roadLook) => set({ roadLook }),
  dragging: false,
  setDragging: (dragging) => set({ dragging }),
  drawTarget: null,
  setDrawTarget: (drawTarget) => set({ drawTarget }),
  drawCurve: false,
  toggleDrawCurve: () => set({ drawCurve: !get().drawCurve, curveControl: null }),
  curveControl: null,
  setCurveControl: (curveControl) => set({ curveControl }),
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
  lens: 'all',
  setLens: (lens) => {
    const layers = { ...get().layers };
    if (lens === 'transit') { layers.transit = true; layers.tram = true; }
    if (lens === 'rail' || lens === 'metro') layers.tram = true;
    if (lens === 'car' || lens === 'walk') layers.roads = true;
    if (lens === 'walk') layers.sidewalks = true;
    if (lens === 'car') layers.sidewalks = false;
    if (lens === 'all') layers.sidewalks = true;
    set({ lens, layers });
  },
  toggleLayer: (id) => set({ layers: { ...get().layers, [id]: !get().layers[id] } }),
  setBasemapOpacity: (basemapOpacity) => set({ basemapOpacity }),
  setLoading: (loading) => set({ loading }),
  flyTo: (bounds) => set({ fly: { bounds, seq: (get().fly?.seq ?? 0) + 1 } }),
}));
