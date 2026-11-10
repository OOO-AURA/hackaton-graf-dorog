import { setMapInstance } from '../map/instance';
import { transitGeoJson, transitRoutes } from '../transit/routes';
import { useTransit } from '../transit/store';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { addEditorLayers, applyLayerVisibility, applyPalette, applyRoadColors, sceneColors, sceneOf, type SourceId } from '../map/layers';
import { buildScene3d } from '../map/mesh3d';
import { junctionGeometry, laneLines, pxPerMetreZ17, zebras, type LaneStyle } from '../map/lanesGeo';
import { drawingConflicts, drawWidth } from '../state/actions';
import { ROAD_TEMPLATES } from '../osm/tags';
import { junctions } from '../osm/lanes';
import { signPoints } from '../osm/signs';
import { vcColor } from '../macro/compute';
import { loadCamera, saveCamera } from '../map/camera';
import { applyBasemapTone, BASE_STYLE } from '../map/style';
import { MAP_PALETTE } from '../map/palette';
import { useUi } from '../state/ui';
import { MapOverlay } from './MapOverlay';
import { applyLens } from '../map/lens';
import { vehicles3dOf } from '../map/vehicles3dRegistry';
import { useSim, vehiclesAt } from '../sim/store';
import { losFeatures, signalFeatures } from '../sim/overlay';
import { useMacro } from '../macro/store';
import { useZoneEditing } from '../macro/useZoneEditing';
import { contextGeoJson, docBounds, nodesGeoJson, roadsGeoJson, railGeoJson, stationGeoJson } from '../map/geojson';
import { useMapInteractions } from '../map/useMapInteractions';
import { currentSelection, useEditor } from '../state/store';
import { useSettledDoc } from '../state/settled';
import { streetWays } from '../osm/street';
import { useBundle } from '../macro/bundleStore';
import { diffFeatures, docDiff } from '../osm/diff';
import { useRoute } from '../state/route';
import type { OsmDoc } from '../osm/types';

const IRKUTSK_CENTER: [number, number] = [104.262, 52.26];

/** A removed map (after hot reload or unmount) has no style; touching it would throw. */
const alive = (map: MapLibreMap | null): map is MapLibreMap => Boolean(map?.style);

const setData = (map: MapLibreMap, id: SourceId, data: unknown) => {
  if (alive(map)) (map.getSource(id) as GeoJSONSource | undefined)?.setData(data as never);
};

const wayLine = (doc: OsmDoc, id: string) => ({
  type: 'Feature', properties: {},
  geometry: { type: 'LineString', coordinates: doc.ways[id].refs.filter((r) => doc.nodes[r]).map((r) => [doc.nodes[r].lon, doc.nodes[r].lat]) },
});

function selectionGeoJson(doc: OsmDoc, sel: ReturnType<typeof currentSelection>, multi: readonly string[]) {
  if (multi.length) return { type: 'FeatureCollection', features: multi.filter((id) => doc.ways[id]).map((id) => wayLine(doc, id)) };
  if (!sel) return { type: 'FeatureCollection', features: [] };
  if (sel.type === 'street') return { type: 'FeatureCollection', features: streetWays(doc, sel.id).map((w) => wayLine(doc, w.id)) };
  if (sel.type === 'way') return { type: 'FeatureCollection', features: [wayLine(doc, sel.id)] };
  const n = doc.nodes[sel.id];
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [n.lon, n.lat] } }] };
}

/** While zones are being placed, the centroids come from the editor state, not from the last result. */
function macroFeatures(features: unknown[], points: Array<[number, number]> | null): unknown[] {
  if (!points) return features;
  const zones = points.map((p, i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: { kind: 'zone', name: `З${i + 1}`, idx: i } }));
  return [...features.filter((f) => (f as { properties: { kind: string } }).properties.kind !== 'zone'), ...zones];
}

function useSyncedSources(map: MapLibreMap | null, pointer: [number, number] | null): void {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => currentSelection(s));
  const report = useEditor((s) => s.report);
  const focusIssue = useEditor((s) => s.focusIssue);
  const drawing = useEditor((s) => s.drawing);
  const basemap = useEditor((s) => s.basemap);
  const selectedWay = selection?.type === 'way' ? selection.id : null;

  useEffect(() => {
    if (!map) return;
    const context = contextGeoJson(doc);
    setData(map, 'buildings', context.buildings);
    setData(map, 'context', context.lines);
    setData(map, 'roads', roadsGeoJson(doc));
    setData(map, 'rails', railGeoJson(doc));
    setData(map, 'stations', stationGeoJson(doc));
  }, [map, doc]);

  useEffect(() => {
    if (!map) return;
    const via = new Set(Object.values(doc.relations).filter((r) => r.tags.type === 'restriction')
      .map((r) => r.members.find((m) => m.role === 'via' && m.type === 'node')?.ref).filter((id): id is string => Boolean(id && doc.nodes[id])));
    setData(map, 'turns', { type: 'FeatureCollection', features: [...via].map((id) => ({ type: 'Feature', properties: { id }, geometry: { type: 'Point', coordinates: [doc.nodes[id].lon, doc.nodes[id].lat] } })) });
  }, [map, doc]);

  const route = useRoute((s) => s.result);
  useEffect(() => {
    if (map) setData(map, 'route', { type: 'FeatureCollection', features: route?.found ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route.coords } }] : [] });
  }, [map, route]);

  const baseDoc = useEditor((s) => s.baseDoc);
  const settledDoc = useSettledDoc();
  const changesOn = useUi((s) => s.layers.changes);
  useEffect(() => {
    // The diff walks every object, so it runs only while the layer is shown.
    if (map) setData(map, 'changes', { type: 'FeatureCollection', features: changesOn ? diffFeatures(docDiff(baseDoc, settledDoc), baseDoc, settledDoc) : [] });
  }, [map, settledDoc, baseDoc, changesOn]);

  const settled = useSettledDoc();
  const routes = useMemo(() => transitRoutes(settled), [settled]);
  const transitSel = useTransit((s) => s.selected);
  useEffect(() => {
    if (map) setData(map, 'transit', transitGeoJson(routes, transitSel));
  }, [map, routes, transitSel]);

  useEffect(() => {
    if (map) setData(map, 'nodes', nodesGeoJson(doc, selectedWay));
  }, [map, doc, selectedWay]);

  const multi = useEditor((s) => s.multi);
  useEffect(() => {
    if (map) setData(map, 'selection', selectionGeoJson(doc, selection, multi));
  }, [map, doc, selection, multi]);
  // Selected buildings are tinted in 3D too.
  const theme = useUi((s) => s.theme);

  useEffect(() => {
    if (!map) return;
    const features = (report?.issues ?? []).map((i) => ({
      type: 'Feature', properties: { id: i.id, kind: i.kind, severity: i.severity, focused: i.id === focusIssue }, geometry: { type: 'Point', coordinates: i.at },
    }));
    setData(map, 'issues', { type: 'FeatureCollection', features });
  }, [map, report, focusIssue]);

  // The road being drawn, as wide as it will be, up to the pointer; buildings in its way in red.
  const templateIndex = useEditor((s) => s.templateIndex);
  const preview = useMemo(() => {
    const points = [...drawing, ...(pointer && drawing.length ? [{ lon: pointer[0], lat: pointer[1] }] : [])];
    const tags = ROAD_TEMPLATES[templateIndex].tags;
    return { points, tags, conflicts: points.length > 1 ? drawingConflicts(doc, points, tags) : [] };
  }, [doc, drawing, pointer, templateIndex]);
  useEffect(() => {
    if (!map) return;
    const { points, tags, conflicts } = preview;
    const coords = points.map((p) => [p.lon, p.lat]);
    const w17 = drawWidth(tags) * pxPerMetreZ17(points[0]?.lat ?? 52);
    const features = [
      ...(coords.length > 1 ? [{ type: 'Feature', properties: { w17, conflict: conflicts.length > 0, rail: Boolean(tags.railway) }, geometry: { type: 'LineString', coordinates: coords } }] : []),
      ...drawing.map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } })),
    ];
    setData(map, 'draw', { type: 'FeatureCollection', features });
    const hit = new Set(conflicts.map((c) => c.wayId));
    setData(map, 'draw-conflicts', { type: 'FeatureCollection', features: [...hit].map((id) => ({
      type: 'Feature', properties: { id }, geometry: { type: 'Polygon', coordinates: [doc.ways[id].refs.map((r) => [doc.nodes[r].lon, doc.nodes[r].lat])] },
    })) });
  }, [map, preview, drawing, doc]);
  // In 3D the buildings in the way are tinted red on the scene, like the selection.
  useEffect(() => {
    if (!alive(map)) return;
    const conflictIds = preview.conflicts.map((c) => c.wayId);
    if (conflictIds.length) sceneOf(map)?.setSelected(conflictIds, [0.93, 0.25, 0.2]);
    else {
      const ids = multi.length ? multi : selection?.type === 'way' ? [selection.id] : [];
      sceneOf(map)?.setSelected(ids, sceneColors(MAP_PALETTE[theme]).selection);
    }
  }, [map, preview, multi, selection, theme]);

  useEffect(() => {
    if (!alive(map)) return;
    map.setLayoutProperty('osm', 'visibility', basemap === 'osm' ? 'visible' : 'none');
    map.setLayoutProperty('satellite', 'visibility', basemap === 'satellite' ? 'visible' : 'none');
  }, [map, basemap]);
}

/** Lanes, links across junctions and, at the selected junction, the lane ends. */
function useLanes(map: MapLibreMap | null): void {
  // Worked out for the whole map: while a node is dragged they wait for it to be let go.
  const doc = useSettledDoc();
  const selection = useEditor((s) => currentSelection(s));
  const theme = useUi((s) => s.theme);
  const flows = useMacro((s) => s.result?.flows);
  const picked = useUi((s) => s.laneLink);
  const style = useMemo<LaneStyle>(() => {
    const load = new Map<string, number>();
    for (const f of (flows?.features ?? []) as Array<{ properties: { kind: string; way?: string; vc?: number } }>) {
      const p = f.properties;
      if (p.kind === 'flow' && p.way && typeof p.vc === 'number') load.set(p.way, Math.max(load.get(p.way) ?? 0, p.vc));
    }
    return { load: (id) => load.get(id) ?? null, color: (vc) => (vc === null ? MAP_PALETTE[theme].lane : vcColor(vc)) };
  }, [flows, theme]);
  const nodes = useMemo(() => junctions(doc), [doc]);
  const editing = selection?.type === 'node' && nodes.includes(selection.id) ? selection.id : null;
  useEffect(() => { if (map) setData(map, 'lanes', laneLines(doc, style)); }, [map, doc, style]);
  useEffect(() => { if (map) setData(map, 'zebras', zebras(doc)); }, [map, doc]);
  useEffect(() => { if (map) setData(map, 'road-signs', signPoints(doc)); }, [map, doc]);
  useEffect(() => {
    if (!map) return;
    const { ends, links, areas, stops, arrows } = junctionGeometry(doc, nodes, editing, style);
    const same = (p: Record<string, unknown>) => Boolean(picked && p.node === picked.node && p.from === picked.from && p.lane === picked.lane && p.turn === picked.turn);
    links.features.forEach((f) => { f.properties.picked = same(f.properties); });
    ends.features.forEach((f) => {
      const p = f.properties;
      f.properties.hot = Boolean(picked && p.node === picked.node && ((p.kind === 'in' && p.arm === picked.from && p.lane === picked.lane) || (p.kind === 'out' && p.arm === picked.to)));
    });
    setData(map, 'lane-links', links);
    setData(map, 'lane-ends', ends);
    setData(map, 'junction-areas', areas);
    setData(map, 'stop-lines', stops);
    setData(map, 'lane-arrows', arrows);
  }, [map, doc, nodes, editing, style, picked]);
}

function useMapLook(map: MapLibreMap | null): void {
  const theme = useUi((s) => s.theme);
  const opacity = useUi((s) => s.basemapOpacity);
  const layers = useUi((s) => s.layers);
  const fly = useUi((s) => s.fly);
  const view3d = useUi((s) => s.view3d);
  useEffect(() => { if (alive(map)) applyPalette(map, MAP_PALETTE[theme]); }, [map, theme]);
  const colorMode = useUi((s) => s.roadColorMode);
  const look = useUi((s) => s.roadLook);
  useEffect(() => { if (alive(map)) applyRoadColors(map, MAP_PALETTE[theme], colorMode, look); }, [map, theme, colorMode, look]);
  useEffect(() => { if (alive(map)) applyBasemapTone(map, theme, opacity); }, [map, theme, opacity]);
  const view3dOn = useUi((s) => s.view3d);
  const lens = useUi((s) => s.lens);
  useEffect(() => { if (alive(map)) { applyLayerVisibility(map, layers, view3dOn); applyLens(map, lens); } }, [map, layers, view3dOn, lens]);
  // The 3D mesh is built only while 3D is on, and again on every edit or theme change; a node
  // being dragged moves on the 2D layers, the mesh follows when it is let go.
  const doc3d = useSettledDoc();
  useEffect(() => {
    if (!alive(map)) return;
    sceneOf(map)?.setMesh(view3dOn ? buildScene3d(doc3d, sceneColors(MAP_PALETTE[theme], look)) : null);
  }, [map, doc3d, theme, view3dOn, look]);
  const simResult = useSim((s) => s.result);
  const simTime = useSim((s) => s.time);
  const workspace = useUi((s) => s.workspace);
  const view3dVeh = useUi((s) => s.view3d);
  useEffect(() => {
    if (!alive(map)) return;
    const empty = { type: 'FeatureCollection', features: [] };
    const data = workspace === 'micro' && simResult ? vehiclesAt(simResult, simTime) : empty;
    setData(map, 'vehicles', data);
    const v3 = vehicles3dOf(map);
    if (v3 && view3dVeh) {
      v3.update((data.features as unknown as Array<{ properties: { angle: number; sprite: string }; geometry: { coordinates: [number, number] } }>)
        .map((f) => ({ lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], angle: f.properties.angle, sprite: f.properties.sprite })));
    }
  }, [map, simResult, simTime, workspace, view3dVeh]);
  const flows = useMacro((s) => s.result?.flows);
  const bundle = useBundle((s) => s.features);
  const iso = useMacro((s) => s.iso);
  const placing = useMacro((s) => s.placing);
  const points = useMacro((s) => s.points);
  // Road LOS of the micro run only changes with the run itself; signals change with time.
  const simDoc = useEditor((s) => s.doc);
  const los = useMemo(() => (simResult ? losFeatures(simDoc, simResult) : []), [simDoc, simResult]);
  useEffect(() => {
    if (!alive(map)) return;
    const features = workspace === 'macro'
      ? [...macroFeatures(flows?.features ?? [], placing ? points : null), ...(iso?.features ?? []), ...bundle]
      : los;
    setData(map, 'macro', { type: 'FeatureCollection', features });
  }, [map, flows, iso, workspace, los, placing, points, bundle]);
  // Signal heads change every frame, so they live in a small source of their own.
  useEffect(() => {
    if (!alive(map)) return;
    setData(map, 'signals', { type: 'FeatureCollection', features: workspace === 'micro' && simResult ? signalFeatures(simResult, simTime) : [] });
  }, [map, workspace, simResult, simTime]);
  // Tilts the camera when 2D/3D is switched, not when the map appears or a saved camera returns.
  const shownView = useRef<{ map: MapLibreMap; view3d: boolean } | null>(null);
  useEffect(() => {
    if (!alive(map)) return;
    const before = shownView.current;
    shownView.current = { map, view3d };
    if (!before || before.map !== map || before.view3d === view3d) return;
    if (restoringCamera) { restoringCamera = false; return; }
    const instant = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    map.easeTo({ pitch: view3d ? 58 : 0, bearing: view3d ? -18 : 0, duration: instant ? 0 : 700 });
  }, [map, view3d]);
  useEffect(() => {
    if (alive(map) && fly) map.fitBounds(fly.bounds, { padding: 80, maxZoom: 17, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 600 });
  }, [map, fly]);
}

/** Set while the camera of a file is being restored, so the 2D/3D switch does not animate it away. */
let restoringCamera = false;

/**
 * On opening a file the camera goes back where it was the last time for that file, 2D or 3D
 * included; a file seen for the first time is fitted into view. The camera is saved as it moves.
 */
function useCameraPerFile(map: MapLibreMap | null): void {
  const fileName = useEditor((s) => s.fileName);
  const past = useEditor((s) => s.past.length);
  useEffect(() => {
    if (!map || past > 0) return;
    const saved = loadCamera(fileName);
    if (saved) {
      if (useUi.getState().view3d !== saved.view3d) {
        restoringCamera = true;
        useUi.setState({ view3d: saved.view3d });
      }
      map.jumpTo({ center: saved.center, zoom: saved.zoom, bearing: saved.bearing, pitch: saved.pitch });
      return;
    }
    const bounds = docBounds(useEditor.getState().doc);
    if (bounds) map.fitBounds(bounds, { padding: 40, duration: 0 });
  }, [map, fileName]);
  useEffect(() => {
    if (!map) return undefined;
    const save = () => {
      const s = useEditor.getState();
      if (Object.keys(s.doc.nodes).length) saveCamera(s.fileName, map, useUi.getState().view3d);
    };
    map.on('moveend', save);
    return () => { map.off('moveend', save); };
  }, [map]);
}

/**
 * The map reaches under the floating panels, so its padding is the free stage between them:
 * fitting a file or flying to an object centres it where it can be seen, not under a panel.
 */
function useStagePadding(map: MapLibreMap | null): void {
  useEffect(() => {
    if (!map) return undefined;
    const wrap = map.getContainer().parentElement;
    const stage = wrap?.querySelector<HTMLElement>('.stage');
    if (!wrap || !stage) return undefined;
    const sync = () => {
      const w = wrap.getBoundingClientRect();
      const s = stage.getBoundingClientRect();
      if (!alive(map)) return;
      map.setPadding({ top: s.top - w.top, left: s.left - w.left, right: w.right - s.right, bottom: w.bottom - s.bottom });
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(stage);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [map]);
}

export function MapView() {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [pointer, setPointer] = useState<[number, number] | null>(null);
  const drawingActive = useEditor((s) => s.mode === 'draw' && s.drawing.length > 0);
  const focusIssue = useEditor((s) => s.focusIssue);

  useEffect(() => {
    if (!container.current) return undefined;
    const instance = new maplibregl.Map({ container: container.current, style: BASE_STYLE, center: IRKUTSK_CENTER, zoom: 15, maxPitch: 70, doubleClickZoom: false });
    instance.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
    instance.on('load', () => {
      addEditorLayers(instance, MAP_PALETTE[useUi.getState().theme]);
      setMap(instance);
      setMapInstance(instance);
    });
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      setMap(null);
      setMapInstance(null);
      instance.remove();
    };
  }, []);

  const onPointer = useCallback((lon: number, lat: number) => {
    if (drawingActive) setPointer([lon, lat]);
  }, [drawingActive]);

  useMapInteractions(map, onPointer);
  useZoneEditing(map);
  useSyncedSources(map, drawingActive ? pointer : null);
  useCameraPerFile(map);
  useStagePadding(map);
  useLanes(map);
  useMapLook(map);

  useEffect(() => {
    const issue = useEditor.getState().report?.issues.find((i) => i.id === focusIssue);
    if (map && issue) map.flyTo({ center: [issue.at[0], issue.at[1]], zoom: Math.max(map.getZoom(), 18) });
  }, [map, focusIssue]);

  return (
    <div className="map-wrap">
      <div ref={container} className="map" />
      <div className="stage"><MapOverlay map={map} /></div>
    </div>
  );
}
