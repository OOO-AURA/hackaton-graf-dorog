import { useEffect, useRef, useState } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { setWayTags } from '../osm/edit';
import { buildingHeight, formatMetres, LAYER_STEP, roadLevel, withBuildingHeight, withRoadLayer } from '../osm/height';
import { isDrivable } from '../osm/tags';
import type { OsmDoc, OsmWay } from '../osm/types';
import { sceneOf } from '../map/layers';
import { haversine } from '../osm/geo';
import { isolatePiece, type Piece } from '../osm/pieces';
import { currentSelection, useEditor } from '../state/store';
import { useUi } from '../state/ui';

type Anchor = { lon: number; lat: number; metres: number };

/**
 * Where the handle sits: the middle of a roof, or the middle of the picked stretch of a road (half
 * its length along it) at its deck height. A stretch is what is lit, so the handle stands on it.
 */
function anchorOf(doc: OsmDoc, way: OsmWay, piece?: Piece): Anchor | null {
  const refs = piece && !way.tags.building ? way.refs.slice(piece.from, piece.to + 1) : way.refs;
  const nodes = refs.map((r) => doc.nodes[r]).filter(Boolean);
  if (!nodes.length) return null;
  if (way.tags.building) {
    const ring = nodes.length > 1 && nodes[0] === nodes[nodes.length - 1] ? nodes.slice(0, -1) : nodes;
    return { lon: ring.reduce((s, n) => s + n.lon, 0) / ring.length, lat: ring.reduce((s, n) => s + n.lat, 0) / ring.length, metres: buildingHeight(way.tags).height };
  }
  const { layer } = roadLevel(way.tags);
  const metres = layer * LAYER_STEP;
  if (nodes.length === 1) return { lon: nodes[0].lon, lat: nodes[0].lat, metres };
  const seg = nodes.slice(1).map((n, i) => haversine([nodes[i].lon, nodes[i].lat], [n.lon, n.lat]));
  let left = seg.reduce((s, v) => s + v, 0) / 2;
  for (let i = 0; i < seg.length; i++) {
    if (left <= seg[i] || i === seg.length - 1) {
      const t = seg[i] > 0 ? Math.min(1, left / seg[i]) : 0;
      return { lon: nodes[i].lon + (nodes[i + 1].lon - nodes[i].lon) * t, lat: nodes[i].lat + (nodes[i + 1].lat - nodes[i].lat) * t, metres };
    }
    left -= seg[i];
  }
  return null;
}

const label = (way: OsmWay) => {
  if (way.tags.building) {
    const h = buildingHeight(way.tags);
    return `${formatMetres(h.height)} м · ${h.levels} эт.`;
  }
  const { kind, layer } = roadLevel(way.tags);
  return kind === 'ground' ? 'на земле' : kind === 'bridge' ? `мост · уровень ${layer}` : `тоннель · уровень ${layer}`;
};

/**
 * In 3D, a handle on top of the selected building or road. Dragging it up or down changes the
 * building's height or the road's level; the whole drag is one undo step.
 */
export function HeightHandle({ map }: { map: MapLibreMap | null }) {
  const view3d = useUi((s) => s.view3d);
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => currentSelection(s));
  const multi = useEditor((s) => s.multi.length > 1);
  const way = selection?.type === 'way' ? doc.ways[selection.id] : null;
  const piece = selection?.type === 'way' ? selection.piece : undefined;
  const editable = Boolean(view3d && way && !multi && (way.tags.building || isDrivable(way.tags)));
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ startY: number; startMetres: number; pxPerMetre: number; id: string } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!map || !editable || !way) { setPos(null); return undefined; }
    const anchor = anchorOf(doc, way, piece);
    // The canvas fills the whole window under the panels; the handle lives in the stage (the free
    // part of the map), so the point is moved from canvas to stage pixels.
    const place = () => {
      const p = anchor ? sceneOf(map)?.project(anchor.lon, anchor.lat, anchor.metres) ?? null : null;
      const stage = map.getContainer().closest('.app')?.querySelector('.stage');
      if (!p || !stage) { setPos(p); return; }
      const c = map.getCanvas().getBoundingClientRect();
      const s = stage.getBoundingClientRect();
      setPos({ x: p.x + c.left - s.left, y: p.y + c.top - s.top });
    };
    place();
    map.on('render', place);
    return () => { map.off('render', place); };
  }, [map, editable, way, doc, piece]);

  if (!editable || !way || !pos || !map) return null;

  const onDown = (e: React.PointerEvent) => {
    const anchor = anchorOf(doc, way, piece);
    const scene = sceneOf(map);
    if (!anchor || !scene) return;
    const a = scene.project(anchor.lon, anchor.lat, anchor.metres);
    const b = scene.project(anchor.lon, anchor.lat, anchor.metres + 10);
    if (!a || !b || Math.abs(a.y - b.y) < 0.5) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY, startMetres: anchor.metres, pxPerMetre: (a.y - b.y) / 10, id: way.id };
    setDragging(true);
    const st = useEditor.getState();
    st.beginGesture();
    // A picked stretch is cut out of its way first (it keeps the way's id), as the inspector does,
    // so the drag lifts only the lit stretch, not the whole OSM line.
    if (piece && !way.tags.building) {
      st.applyLive((d0) => isolatePiece(d0, way.id, piece));
      st.select({ type: 'way', id: way.id });
    }
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const metres = d.startMetres + (d.startY - e.clientY) / d.pxPerMetre;
    useEditor.getState().applyLive((doc0) => {
      const w = doc0.ways[d.id];
      if (!w) return doc0;
      const tags = w.tags.building ? withBuildingHeight(w.tags, Math.round(metres)) : withRoadLayer(w.tags, Math.round(metres / LAYER_STEP));
      return JSON.stringify(tags) === JSON.stringify(w.tags) ? doc0 : setWayTags(doc0, d.id, tags);
    });
  };
  const onUp = () => { drag.current = null; setDragging(false); };

  return (
    <div className={`height-handle${dragging ? ' on' : ''}`} style={{ left: pos.x, top: pos.y }}>
      <button
        className="height-grip" aria-label="Потяните вверх или вниз, чтобы изменить высоту"
        title="Потяните вверх или вниз" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      >
        <svg viewBox="0 0 12 20" width="10" height="16" aria-hidden="true"><path d="M6 1 L11 7 H1 Z M6 19 L1 13 H11 Z" fill="currentColor" /></svg>
      </button>
      <span className="height-label mono">{label(way)}</span>
    </div>
  );
}
