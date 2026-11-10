import { create } from 'zustand';
import type { RoadColorMode } from '../map/thematic';
import type { DrawTarget } from '../map/drawSnap';
import type { Lens } from '../map/lens';
import { stepForTab, stepForWorkspace, stepInfo, type Step } from './steps';

export type Theme = 'light' | 'dark';
export type ThemeChoice = Theme | 'system';
export type Workspace = 'macro' | 'micro';
/** How roads look: coloured by class like a graph, or as asphalt with markings like an engineering plan. */
export type RoadLook = 'graph' | 'engineering' | 'scheme';
export type BottomTab = 'issues' | 'check' | 'flows' | 'transit' | 'scenarios' | 'journal' | 'errors' | 'submit';
/** Tab of the navigator: objects of the graph, how the map looks, the legend. */
export type NavTab = 'objects' | 'view' | 'legend';
export type LayerId = 'roads' | 'sidewalks' | 'junctions' | 'signals' | 'crossings' | 'bridges' | 'tunnels' | 'buildings' | 'tram' | 'signs' | 'transit' | 'changes';

export const LAYER_IDS: readonly LayerId[] = ['roads', 'sidewalks', 'junctions', 'signals', 'crossings', 'bridges', 'tunnels', 'buildings', 'tram', 'signs', 'transit', 'changes'];

/** Layers that start hidden: they are overlays for a particular task. */
const OFF_BY_DEFAULT: ReadonlySet<LayerId> = new Set(['transit', 'changes']);

const THEME_KEY = 'graf.theme';
const HINTS_KEY = 'graf.map-hints';

function readHints(): boolean {
  try { return localStorage.getItem(HINTS_KEY) !== 'off'; } catch { return true; }
}

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
  /** Step of the work shown in the header (see state/steps.ts). */
  step: Step;
  setStep: (step: Step) => void;
  /** Help with the steps and hotkeys, over the map. */
  helpOpen: boolean;
  navTab: NavTab;
  /** The line at the bottom of the map that says what the tool and the selection let you do. */
  mapHints: boolean;
  setMapHints: (on: boolean) => void;
  setNavTab: (tab: NavTab) => void;
  setHelpOpen: (open: boolean) => void;
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
  /** What the T tool puts: a NODE_FEATURES id, or `ts:<code>` for a road sign (osm/trafficSigns.ts). */
  featureKind: string;
  setFeatureKind: (id: string) => void;
  /** The number on a sign that has one (3.24 speed). */
  signValue: number;
  setSignValue: (v: number) => void;
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
  /** Junction whose card was closed: the card stays shut for it, the inspector stays open. */
  /** The junction whose editor window is open (double click on a junction), or null. */
  junctionEditor: string | null;
  setJunctionEditor: (nodeId: string | null) => void;
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

/** Layers as they were before a view mode changed them; null in «Все объекты». */
let lensBase: Record<LayerId, boolean> | null = null;

export const useUi = create<UiState>((set, get) => ({
  laneLink: null,
  setLaneLink: (laneLink) => set({ laneLink }),
  themeChoice: initialChoice,
  theme: resolveTheme(initialChoice),
  workspace: 'macro',
  step: 'edit',
  setStep: (step) => {
    const info = stepInfo(step);
    const tab = info.opens ?? (info.tabs.includes(get().bottomTab) ? get().bottomTab : info.tabs[0]);
    set({ step, workspace: info.workspace, bottomTab: tab, bottomOpen: info.opens !== null });
  },
  helpOpen: false,
  navTab: 'objects',
  mapHints: readHints(),
  setMapHints: (mapHints) => {
    try { localStorage.setItem(HINTS_KEY, mapHints ? 'on' : 'off'); } catch { /* storage may be off; the choice holds for this session */ }
    set({ mapHints });
  },
  setNavTab: (navTab) => set({ navTab }),
  setHelpOpen: (helpOpen) => set({ helpOpen }),
  bottomTab: 'issues',
  bottomOpen: false,
  layers: Object.fromEntries(LAYER_IDS.map((id) => [id, !OFF_BY_DEFAULT.has(id)])) as Record<LayerId, boolean>,
  basemapOpacity: 0.7,
  loading: null,
  view3d: false,
  toggle3d: () => set({ view3d: !get().view3d }),
  featureKind: 'signal',
  setFeatureKind: (featureKind) => set({ featureKind }),
  signValue: 40,
  setSignValue: (signValue) => set({ signValue }),
  fly: null,
  roadColorMode: 'class',
  setRoadColorMode: (roadColorMode) => set({ roadColorMode }),
  roadLook: 'engineering',
  setRoadLook: (roadLook) => set({ roadLook }),
  dragging: false,
  setDragging: (dragging) => set({ dragging }),
  drawTarget: null,
  setDrawTarget: (drawTarget) => set({ drawTarget }),
  junctionEditor: null,
  setJunctionEditor: (junctionEditor) => set({ junctionEditor }),
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
  setWorkspace: (workspace) => {
    const step = stepForWorkspace(workspace, get().step);
    const tabs = stepInfo(step).tabs;
    set({ workspace, step, bottomTab: tabs.includes(get().bottomTab) ? get().bottomTab : tabs[0] });
  },
  openBottom: (bottomTab) => {
    const step = stepForTab(bottomTab, get().step);
    set({ bottomTab, bottomOpen: true, step, workspace: stepInfo(step).workspace });
  },
  toggleBottom: () => set({ bottomOpen: !get().bottomOpen }),
  lens: 'all',
  setLens: (lens) => {
    // A view mode switches its own layers on; leaving it gives the layers back as they were.
    const layers = { ...(lensBase ?? get().layers) };
    lensBase = lens === 'all' ? null : { ...layers };
    if (lens === 'transit') { layers.transit = true; layers.tram = true; }
    if (lens === 'rail' || lens === 'metro') layers.tram = true;
    if (lens === 'car' || lens === 'walk' || lens === 'signs') layers.roads = true;
    if (lens === 'signs') { layers.signals = true; layers.signs = true; layers.crossings = true; }
    if (lens === 'walk') layers.sidewalks = true;
    if (lens === 'car') layers.sidewalks = false;
    if (lens === 'all') layers.sidewalks = true;
    set({ lens, layers });
  },
  toggleLayer: (id) => {
    // A layer switched by hand inside a view mode stays so after leaving it.
    if (lensBase) lensBase = { ...lensBase, [id]: !get().layers[id] };
    set({ layers: { ...get().layers, [id]: !get().layers[id] } });
  },
  setBasemapOpacity: (basemapOpacity) => set({ basemapOpacity }),
  setLoading: (loading) => set({ loading }),
  flyTo: (bounds) => set({ fly: { bounds, seq: (get().fly?.seq ?? 0) + 1 } }),
}));
