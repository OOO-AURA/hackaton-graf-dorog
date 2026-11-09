import { setMapInstance } from '../map/instance';
import { transitGeoJson, transitRoutes } from '../transit/routes';
import { useTransit } from '../transit/store';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { addEditorLayers, applyLayerVisibility, applyPalette, type SourceId } from '../map/layers';
import { applyBasemapTone, BASE_STYLE } from '../map/style';
import { MAP_PALETTE } from '../map/palette';
import { useUi } from '../state/ui';
import { MapOverlay } from './MapOverlay';
import { useSim, vehiclesAt } from '../sim/store';
import { losFeatures, signalFeatures } from '../sim/overlay';
import { useMacro } from '../macro/store';
import { useZoneEditing } from '../macro/useZoneEditing';
import { contextGeoJson, docBounds, nodesGeoJson, roadsGeoJson } from '../map/geojson';
import { useMapInteractions } from '../map/useMapInteractions';
import { currentSelection, useEditor } from '../state/store';
import { streetWays } from '../osm/street';
import { bridgeFeatures } from '../map/bridges3d';
import { useBundle } from '../macro/bundleStore';
import type { OsmDoc } from '../osm/types';

const IRKUTSK_CENTER: [number, number] = [104.262, 52.26];

/** A removed map (after hot reload or unmount) has no style; touching it would throw. */
const alive = (map: MapLibreMap | null): map is MapLibreMap => Boolean(map?.style);

const setData = (map: MapLibreMap, id: SourceId, data: unknown) => {
  if (alive(map)) (map.getSource(id) as GeoJSONSource | undefined)?.setData(data as never);
};

const wayLine = (doc: OsmDoc, id: string) => ({
  type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: doc.ways[id].refs.map((r) => [doc.nodes[r].lon, doc.nodes[r].lat]) },
});

function selectionGeoJson(doc: OsmDoc, sel: ReturnType<typeof currentSelection>) {
  if (!sel) return { type: 'FeatureCollection', features: [] };
  if (sel.type === 'street') return { type: 'FeatureCollection', features: streetWays(doc, sel.id).map((w) => wayLine(doc, w.id)) };
  const geometry = sel.type === 'node'
    ? { type: 'Point', coordinates: [doc.nodes[sel.id].lon, doc.nodes[sel.id].lat] }
    : { type: 'LineString', coordinates: doc.ways[sel.id].refs.map((r) => [doc.nodes[r].lon, doc.nodes[r].lat]) };
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry }] };
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
  }, [map, doc]);

  useEffect(() => {
    if (!map) return;
    const via = new Set(Object.values(doc.relations).filter((r) => r.tags.type === 'restriction')
      .map((r) => r.members.find((m) => m.role === 'via' && m.type === 'node')?.ref).filter((id): id is string => Boolean(id && doc.nodes[id])));
    setData(map, 'turns', { type: 'FeatureCollection', features: [...via].map((id) => ({ type: 'Feature', properties: { id }, geometry: { type: 'Point', coordinates: [doc.nodes[id].lon, doc.nodes[id].lat] } })) });
  }, [map, doc]);

  const view3d = useUi((s) => s.view3d);
  useEffect(() => {
    // Decks and ramps are only drawn in 3D, so they are not rebuilt on every edit in 2D.
    if (map) setData(map, 'bridges3d', view3d ? bridgeFeatures(doc) : { type: 'FeatureCollection', features: [] });
  }, [map, doc, view3d]);

  const routes = useMemo(() => transitRoutes(doc), [doc]);
  const transitSel = useTransit((s) => s.selected);
  useEffect(() => {
    if (map) setData(map, 'transit', transitGeoJson(routes, transitSel));
  }, [map, routes, transitSel]);

  useEffect(() => {
    if (map) setData(map, 'nodes', nodesGeoJson(doc, selectedWay));
  }, [map, doc, selectedWay]);

  useEffect(() => {
    if (map) setData(map, 'selection', selectionGeoJson(doc, selection));
  }, [map, doc, selection]);

  useEffect(() => {
    if (!map) return;
    const features = (report?.issues ?? []).map((i) => ({
      type: 'Feature', properties: { id: i.id, kind: i.kind, severity: i.severity, focused: i.id === focusIssue }, geometry: { type: 'Point', coordinates: i.at },
    }));
    setData(map, 'issues', { type: 'FeatureCollection', features });
  }, [map, report, focusIssue]);

  useEffect(() => {
    if (!map) return;
    const coords = [...drawing.map((p) => [p.lon, p.lat]), ...(pointer && drawing.length ? [pointer] : [])];
    const features = [
      ...(coords.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }] : []),
      ...drawing.map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } })),
    ];
    setData(map, 'draw', { type: 'FeatureCollection', features });
  }, [map, drawing, pointer]);

  useEffect(() => {
    if (!alive(map)) return;
    map.setLayoutProperty('osm', 'visibility', basemap === 'osm' ? 'visible' : 'none');
    map.setLayoutProperty('satellite', 'visibility', basemap === 'satellite' ? 'visible' : 'none');
  }, [map, basemap]);
}

function useMapLook(map: MapLibreMap | null): void {
  const theme = useUi((s) => s.theme);
  const opacity = useUi((s) => s.basemapOpacity);
  const layers = useUi((s) => s.layers);
  const fly = useUi((s) => s.fly);
  const view3d = useUi((s) => s.view3d);
  useEffect(() => { if (alive(map)) applyPalette(map, MAP_PALETTE[theme]); }, [map, theme]);
  useEffect(() => { if (alive(map)) applyBasemapTone(map, theme, opacity); }, [map, theme, opacity]);
  useEffect(() => { if (alive(map)) applyLayerVisibility(map, layers); }, [map, layers]);
  const simResult = useSim((s) => s.result);
  const simTime = useSim((s) => s.time);
  const workspace = useUi((s) => s.workspace);
  useEffect(() => {
    if (!alive(map)) return;
    const empty = { type: 'FeatureCollection', features: [] };
    setData(map, 'vehicles', workspace === 'micro' && simResult ? vehiclesAt(simResult, simTime) : empty);
  }, [map, simResult, simTime, workspace]);
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
  useEffect(() => {
    if (!alive(map)) return;
    const instant = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    map.setLayoutProperty('buildings-3d', 'visibility', view3d ? 'visible' : 'none');
    // In 3D the bridge is drawn as a raised deck, so its flat line and shadow on the ground go away.
    map.setLayoutProperty('bridges-3d', 'visibility', view3d && layers.bridges ? 'visible' : 'none');
    map.setLayoutProperty('roads-bridge', 'visibility', !view3d && layers.roads && layers.bridges ? 'visible' : 'none');
    map.setLayoutProperty('bridge-shadow', 'visibility', !view3d && layers.roads && layers.bridges ? 'visible' : 'none');
    map.setLayoutProperty('buildings', 'visibility', view3d || !layers.buildings ? 'none' : 'visible');
    map.easeTo({ pitch: view3d ? 58 : 0, bearing: view3d ? -18 : 0, duration: instant ? 0 : 700 });
  }, [map, view3d, layers.buildings, layers.bridges, layers.roads]);
  useEffect(() => {
    if (alive(map) && fly) map.fitBounds(fly.bounds, { padding: 80, maxZoom: 17, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 600 });
  }, [map, fly]);
}

function useFitOnLoad(map: MapLibreMap | null): void {
  const fileName = useEditor((s) => s.fileName);
  const past = useEditor((s) => s.past.length);
  useEffect(() => {
    if (!map || past > 0) return;
    const bounds = docBounds(useEditor.getState().doc);
    if (bounds) map.fitBounds(bounds, { padding: 40, duration: 0 });
  }, [map, fileName]);
}

export function MapView() {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [pointer, setPointer] = useState<[number, number] | null>(null);
  const drawingActive = useEditor((s) => s.mode === 'draw' && s.drawing.length > 0);
  const focusIssue = useEditor((s) => s.focusIssue);

  useEffect(() => {
    if (!container.current) return undefined;
    const instance = new maplibregl.Map({ container: container.current, style: BASE_STYLE, center: IRKUTSK_CENTER, zoom: 15, doubleClickZoom: false });
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
  useFitOnLoad(map);
  useMapLook(map);

  useEffect(() => {
    const issue = useEditor.getState().report?.issues.find((i) => i.id === focusIssue);
    if (map && issue) map.flyTo({ center: [issue.at[0], issue.at[1]], zoom: Math.max(map.getZoom(), 18) });
  }, [map, focusIssue]);

  return (
    <div className="map-wrap">
      <div ref={container} className="map" />
      <MapOverlay map={map} />
    </div>
  );
}
