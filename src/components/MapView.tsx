import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { addEditorLayers, applyLayerVisibility, applyPalette, type SourceId } from '../map/layers';
import { applyBasemapTone, BASE_STYLE } from '../map/style';
import { MAP_PALETTE } from '../map/palette';
import { useUi } from '../state/ui';
import { MapOverlay } from './MapOverlay';
import { contextGeoJson, docBounds, nodesGeoJson, roadsGeoJson } from '../map/geojson';
import { useMapInteractions } from '../map/useMapInteractions';
import { currentSelection, useEditor } from '../state/store';
import type { OsmDoc } from '../osm/types';

const IRKUTSK_CENTER: [number, number] = [104.262, 52.26];

/** A removed map (after hot reload or unmount) has no style; touching it would throw. */
const alive = (map: MapLibreMap | null): map is MapLibreMap => Boolean(map?.style);

const setData = (map: MapLibreMap, id: SourceId, data: unknown) => {
  if (alive(map)) (map.getSource(id) as GeoJSONSource | undefined)?.setData(data as never);
};

function selectionGeoJson(doc: OsmDoc, sel: ReturnType<typeof currentSelection>) {
  if (!sel) return { type: 'FeatureCollection', features: [] };
  const geometry = sel.type === 'node'
    ? { type: 'Point', coordinates: [doc.nodes[sel.id].lon, doc.nodes[sel.id].lat] }
    : { type: 'LineString', coordinates: doc.ways[sel.id].refs.map((r) => [doc.nodes[r].lon, doc.nodes[r].lat]) };
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry }] };
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
  useEffect(() => { if (alive(map)) applyPalette(map, MAP_PALETTE[theme]); }, [map, theme]);
  useEffect(() => { if (alive(map)) applyBasemapTone(map, theme, opacity); }, [map, theme, opacity]);
  useEffect(() => { if (alive(map)) applyLayerVisibility(map, layers); }, [map, layers]);
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
    });
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      setMap(null);
      instance.remove();
    };
  }, []);

  const onPointer = useCallback((lon: number, lat: number) => {
    if (drawingActive) setPointer([lon, lat]);
  }, [drawingActive]);

  useMapInteractions(map, onPointer);
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
