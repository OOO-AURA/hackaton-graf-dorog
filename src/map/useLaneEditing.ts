import { useEffect } from 'react';
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import { useEditor } from '../state/store';
import { useUi } from '../state/ui';
import { connectLanes } from '../state/laneActions';
import { HIT_LAYERS } from './layers';

const TOLERANCE = 6;

type EndProps = { node: string; arm: string; lane: number; kind: 'in' | 'out' };

function endAt(map: MapLibreMap, p: { x: number; y: number }): { props: EndProps; at: [number, number] } | null {
  const box: [[number, number], [number, number]] = [[p.x - TOLERANCE, p.y - TOLERANCE], [p.x + TOLERANCE, p.y + TOLERANCE]];
  const f = map.queryRenderedFeatures(box, { layers: [...HIT_LAYERS.laneEnds] })[0];
  if (!f) return null;
  const c = (f.geometry as GeoJSON.Point).coordinates;
  return { props: f.properties as unknown as EndProps, at: [c[0], c[1]] };
}

/** Lane link of the edited junction under a point, if any. */
export function laneLinkAt(map: MapLibreMap, p: { x: number; y: number }) {
  const box: [[number, number], [number, number]] = [[p.x - TOLERANCE, p.y - TOLERANCE], [p.x + TOLERANCE, p.y + TOLERANCE]];
  const f = map.queryRenderedFeatures(box, { layers: [...HIT_LAYERS.laneLinks] }).find((x) => x.properties?.edit);
  if (!f) return null;
  const pr = f.properties as { node: string; from: string; lane: number; to: string; turn: string };
  return { node: pr.node, from: pr.from, lane: Number(pr.lane), to: pr.to, turn: pr.turn };
}

const setDraft = (map: MapLibreMap, coords: Array<[number, number]>) =>
  (map.style ? map.getSource('draw') as GeoJSONSource | undefined : undefined)?.setData({
    type: 'FeatureCollection',
    features: coords.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }] : [],
  });

/**
 * At the selected junction, dragging from a lane coming in (red) to a lane going out (blue)
 * allows that turn from that lane.
 */
export function useLaneEditing(map: MapLibreMap | null): void {
  useEffect(() => {
    if (!map) return undefined;
    let start: { props: EndProps; at: [number, number] } | null = null;
    const onDown = (e: MapMouseEvent) => {
      if (useEditor.getState().mode !== 'select' || e.originalEvent.button !== 0) return;
      const hit = endAt(map, e.point);
      if (!hit || hit.props.kind !== 'in') return;
      e.preventDefault();
      start = hit;
      map.dragPan.disable();
      useUi.getState().setLaneLink(null);
    };
    const onMove = (e: MapMouseEvent) => {
      if (start) setDraft(map, [start.at, [e.lngLat.lng, e.lngLat.lat]]);
    };
    const onUp = (e: MapMouseEvent) => {
      if (!start) return;
      const from = start;
      start = null;
      map.dragPan.enable();
      setDraft(map, []);
      const hit = endAt(map, e.point);
      if (hit && hit.props.kind === 'out' && hit.props.node === from.props.node) {
        connectLanes(from.props.node, from.props.arm, Number(from.props.lane), hit.props.arm);
      }
    };
    map.on('mousedown', onDown);
    map.on('mousemove', onMove);
    map.on('mouseup', onUp);
    return () => {
      map.off('mousedown', onDown);
      map.off('mousemove', onMove);
      map.off('mouseup', onUp);
    };
  }, [map]);
}
