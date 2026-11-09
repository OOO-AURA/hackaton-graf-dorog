import { useEffect } from 'react';
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import { insertNodeInWay, mergeNodes, moveNode } from '../osm/edit';
import { useUi } from '../state/ui';
import { featureById, toggleNodeFeature } from './features';
import { useEditor } from '../state/store';
import { finishDrawing } from '../state/actions';
import { hitBuilding, hitNode, hitWay } from './hit';
import { useBoxSelect } from './useBoxSelect';
import { zoneEditingActive } from '../macro/useZoneEditing';

const DRAG_THRESHOLD_PX = 3;

function handleClick(map: MapLibreMap, e: MapMouseEvent): void {
  if (zoneEditingActive()) return;
  const s = useEditor.getState();
  const nodeId = hitNode(map, e.point);
  const way = nodeId ? null : hitWay(map, s.doc, e.point);

  switch (s.mode) {
    case 'select':
      if (nodeId || way) { s.select(nodeId ? { type: 'node', id: nodeId } : { type: 'way', id: way!.wayId }); return; }
      // Nodes and roads come first: they are small and lie under the buildings in 3D.
      void hitBuilding(map, e.point).then((id) => useEditor.getState().select(id ? { type: 'way', id } : null));
      return;
    case 'signal': {
      const feature = featureById(useUi.getState().featureKind);
      if (nodeId) { s.apply((d) => toggleNodeFeature(d, nodeId, feature)); s.select({ type: 'node', id: nodeId }); return; }
      if (!way) return;
      let created = '';
      s.apply((d) => {
        const r = insertNodeInWay(d, way.wayId, way.index, way.lon, way.lat);
        created = r.id;
        return toggleNodeFeature(r.doc, r.id, feature);
      });
      if (created) s.select({ type: 'node', id: created });
      return;
    }
    case 'insert': {
      if (!way) return;
      let created = '';
      s.apply((d) => {
        const r = insertNodeInWay(d, way.wayId, way.index, way.lon, way.lat);
        created = r.id;
        return r.doc;
      });
      if (created) s.select({ type: 'node', id: created });
      return;
    }
    case 'draw': {
      const last = s.drawing[s.drawing.length - 1];
      if (last) {
        const p = map.project([last.lon, last.lat]);
        if (Math.hypot(p.x - e.point.x, p.y - e.point.y) < DRAG_THRESHOLD_PX * 2) return;
      }
      const { lng, lat } = e.lngLat;
      const point = nodeId
        ? { lon: s.doc.nodes[nodeId].lon, lat: s.doc.nodes[nodeId].lat, nodeId }
        : way ? { lon: way.lon, lat: way.lat, wayId: way.wayId } : { lon: lng, lat };
      s.setDrawing([...s.drawing, point]);
    }
  }
}

/** Dragging a node in select mode; dropping it onto another node merges them into one intersection. */
function useNodeDrag(map: MapLibreMap | null): void {
  useEffect(() => {
    if (!map) return undefined;
    let dragId: string | null = null;
    let started = false;
    let origin = { x: 0, y: 0 };

    const onDown = (e: MapMouseEvent) => {
      const s = useEditor.getState();
      if (s.mode !== 'select' || e.originalEvent.button !== 0 || zoneEditingActive()) return;
      const id = hitNode(map, e.point);
      if (!id) return;
      e.preventDefault();
      dragId = id;
      started = false;
      origin = e.point;
      map.dragPan.disable();
    };
    const onMove = (e: MapMouseEvent) => {
      if (!dragId) return;
      const s = useEditor.getState();
      if (!started) {
        if (Math.hypot(e.point.x - origin.x, e.point.y - origin.y) < DRAG_THRESHOLD_PX) return;
        started = true;
        s.beginGesture();
        s.select({ type: 'node', id: dragId });
      }
      const id = dragId;
      s.applyLive((d) => moveNode(d, id, e.lngLat.lng, e.lngLat.lat));
    };
    const onUp = (e: MapMouseEvent) => {
      if (!dragId) return;
      const id = dragId;
      dragId = null;
      map.dragPan.enable();
      if (!started) return;
      const target = hitNode(map, e.point, id);
      if (!target) return;
      const s = useEditor.getState();
      s.applyLive((d) => mergeNodes(d, target, id));
      s.select({ type: 'node', id: target });
      s.notify('Узлы объединены в перекрёсток');
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

export function useMapInteractions(map: MapLibreMap | null, onPointer: (lon: number, lat: number) => void): void {
  useNodeDrag(map);
  useBoxSelect(map);
  useEffect(() => {
    if (!map) return undefined;
    const onClick = (e: MapMouseEvent) => handleClick(map, e);
    const onMove = (e: MapMouseEvent) => {
      onPointer(e.lngLat.lng, e.lngLat.lat);
      if (zoneEditingActive()) return;
      const s = useEditor.getState();
      const hovering = s.mode !== 'draw' && (hitNode(map, e.point) || hitWay(map, s.doc, e.point));
      map.getCanvas().style.cursor = s.mode === 'draw' ? 'crosshair' : hovering ? 'pointer' : '';
    };
    const onDblClick = () => { if (useEditor.getState().mode === 'draw') finishDrawing(); };
    map.on('click', onClick);
    map.on('dblclick', onDblClick);
    map.on('mousemove', onMove);
    return () => {
      map.off('click', onClick);
      map.off('dblclick', onDblClick);
      map.off('mousemove', onMove);
    };
  }, [map, onPointer]);
}
