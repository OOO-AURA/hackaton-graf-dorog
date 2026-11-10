import { useEffect } from 'react';
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import { insertNodeInWay, mergeNodes, moveNode } from '../osm/edit';
import { useUi } from '../state/ui';
import { featureById, toggleNodeFeature } from './features';
import { useEditor } from '../state/store';
import { finishDrawing } from '../state/actions';
import { hitBuilding, hitNode, hitWay } from './hit';
import { drawTarget } from './drawSnap';
import { curvePoints } from '../osm/drawGeometry';
import { isBuilding } from '../osm/building';
import { useBoxSelect } from './useBoxSelect';
import { placeGhost, useBuildingGhost } from './buildingTool';
import { HANDLE_LAYERS, useBuildingEditing } from './useBuildingEditing';
import { setPointer } from '../state/buildingActions';
import { laneLinkAt, useLaneEditing } from './useLaneEditing';
import { zoneEditingActive } from '../macro/useZoneEditing';

const DRAG_THRESHOLD_PX = 3;

function handleClick(map: MapLibreMap, e: MapMouseEvent): void {
  if (zoneEditingActive()) return;
  const s = useEditor.getState();
  // At the junction being edited a click on a lane link picks it; Delete then forbids that turn.
  // Handles of the building being shaped act on their own (useBuildingEditing).
  if (s.mode === 'select' && map.queryRenderedFeatures([e.point.x, e.point.y], { layers: HANDLE_LAYERS.filter((l) => map.getLayer(l)) as unknown as string[] }).length) return;
  if (s.mode === 'select') {
    const link = laneLinkAt(map, e.point);
    useUi.getState().setLaneLink(link);
    if (link) return;
    // A lane end is where a link is dragged from: a click on it keeps the junction selected.
    if (map.queryRenderedFeatures([e.point.x, e.point.y], { layers: ['lane-ends'] }).length) return;
  }
  const nodeId = hitNode(map, e.point);
  const way = nodeId ? null : hitWay(map, s.doc, e.point);

  switch (s.mode) {
    case 'select': {
      if (nodeId) { s.select({ type: 'node', id: nodeId }); return; }
      // In 3D a bridge deck is picked where it is drawn, above the ground; it wins over a road
      // line under the cursor. Otherwise roads come before buildings: they are thin and lie
      // under the buildings.
      void hitBuilding(map, e.point).then((id) => {
        const st = useEditor.getState();
        const picked = id ? st.doc.ways[id] : null;
        if (picked && !isBuilding(picked.tags)) st.select({ type: 'way', id: picked.id });
        else if (way) st.select({ type: 'way', id: way.wayId });
        else st.select(picked ? { type: 'way', id: picked.id } : null);
      });
      return;
    }
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
    case 'building': {
      const id = placeGhost();
      if (id) useEditor.getState().select({ type: 'way', id });
      return;
    }
    case 'draw': {
      const last = s.drawing[s.drawing.length - 1];
      if (last) {
        const p = map.project([last.lon, last.lat]);
        if (Math.hypot(p.x - e.point.x, p.y - e.point.y) < DRAG_THRESHOLD_PX * 2) return;
      }
      const ui = useUi.getState();
      // In curve mode the first click after a point only bends the road; the next one ends the curve.
      if (ui.drawCurve && last && !ui.curveControl) {
        ui.setCurveControl({ lon: e.lngLat.lng, lat: e.lngLat.lat });
        return;
      }
      const target = drawTarget(map, s.doc, e.point, e.lngLat, s.drawing, e.originalEvent.shiftKey);
      const { snap: _snap, turn: _turn, length: _length, ...point } = target;
      const bend = ui.drawCurve && last && ui.curveControl ? curvePoints(last, ui.curveControl, point) : [];
      ui.setCurveControl(null);
      s.setDrawing([...s.drawing, ...bend, point]);
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
    // The pointer moves faster than the screen redraws: the node moves at most once a frame.
    let pending: { lng: number; lat: number } | null = null;
    let frame = 0;
    const flush = () => {
      frame = 0;
      if (!dragId || !pending) return;
      const [id, to] = [dragId, pending];
      pending = null;
      useEditor.getState().applyLive((d) => moveNode(d, id, to.lng, to.lat));
    };
    const onMove = (e: MapMouseEvent) => {
      if (!dragId) return;
      const s = useEditor.getState();
      if (!started) {
        if (Math.hypot(e.point.x - origin.x, e.point.y - origin.y) < DRAG_THRESHOLD_PX) return;
        started = true;
        s.beginGesture();
        s.select({ type: 'node', id: dragId });
        useUi.getState().setDragging(true);
      }
      pending = { lng: e.lngLat.lng, lat: e.lngLat.lat };
      if (!frame) frame = requestAnimationFrame(flush);
    };
    const onUp = (e: MapMouseEvent) => {
      if (!dragId) return;
      const id = dragId;
      if (frame) cancelAnimationFrame(frame);
      flush();
      dragId = null;
      map.dragPan.enable();
      if (!started) return;
      // Letting go brings the costly layers up to date in one go.
      useUi.getState().setDragging(false);
      const target = hitNode(map, e.point, id);
      if (!target) return;
      const s = useEditor.getState();
      s.applyLive((d) => mergeNodes(d, target, id));
      s.select({ type: 'node', id: target });
      s.notify('Узлы объединены в перекрёсток');
    };
    // Let go outside the map: the drag still ends, without merging.
    const onWindowUp = () => {
      if (!dragId) return;
      if (frame) cancelAnimationFrame(frame);
      flush();
      dragId = null;
      map.dragPan.enable();
      useUi.getState().setDragging(false);
    };
    map.on('mousedown', onDown);
    map.on('mousemove', onMove);
    map.on('mouseup', onUp);
    window.addEventListener('mouseup', onWindowUp);
    return () => {
      map.off('mousedown', onDown);
      map.off('mousemove', onMove);
      map.off('mouseup', onUp);
      window.removeEventListener('mouseup', onWindowUp);
    };
  }, [map]);
}

export function useMapInteractions(map: MapLibreMap | null, onPointer: (lon: number, lat: number) => void): void {
  useNodeDrag(map);
  useBoxSelect(map);
  useLaneEditing(map);
  useBuildingGhost(map);
  useBuildingEditing(map);
  useEffect(() => {
    if (!map) return undefined;
    const onClick = (e: MapMouseEvent) => handleClick(map, e);
    const onMove = (e: MapMouseEvent) => {
      onPointer(e.lngLat.lng, e.lngLat.lat);
      setPointer([e.lngLat.lng, e.lngLat.lat]);
      if (zoneEditingActive()) return;
      const s = useEditor.getState();
      if (s.mode === 'draw') useUi.getState().setDrawTarget(drawTarget(map, s.doc, e.point, e.lngLat, s.drawing, e.originalEvent.shiftKey));
      else if (useUi.getState().drawTarget) useUi.getState().setDrawTarget(null);
      const placing = s.mode === 'draw' || s.mode === 'building';
      const hovering = !placing && (hitNode(map, e.point) || hitWay(map, s.doc, e.point));
      map.getCanvas().style.cursor = placing ? 'crosshair' : hovering ? 'pointer' : '';
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
