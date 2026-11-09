import { useRef } from 'react';
import {
  buildingHeight, formatMetres, LAYER_STEP, MAX_BUILDING_HEIGHT, MAX_LAYER, MIN_LAYER, roadLevel,
  withBuildingHeight, withBuildingLevels, withMinHeight, withRoadKind, withRoadLayer, type RoadLevelKind,
} from '../osm/height';
import { setWayTags } from '../osm/edit';
import type { OsmDoc, Tags } from '../osm/types';
import { useEditor } from '../state/store';
import { TextField } from './fields';

/** Rewrites the tags of several ways in one document step. */
function retag(doc: OsmDoc, ids: readonly string[], change: (tags: Tags) => Tags): OsmDoc {
  return ids.reduce((d, id) => {
    const w = d.ways[id];
    if (!w) return d;
    const tags = change(w.tags);
    return tags === w.tags || JSON.stringify(tags) === JSON.stringify(w.tags) ? d : setWayTags(d, id, tags);
  }, doc);
}

/** Applies a tag change to ways as one undo step. */
export const applyTags = (ids: readonly string[], change: (tags: Tags) => Tags) =>
  useEditor.getState().apply((d) => retag(d, ids, change));

/**
 * Range input that edits live while dragged and leaves a single undo step for the whole drag.
 */
function LiveRange({ label, value, min, max, step, ids, change, format }: {
  label: string; value: number; min: number; max: number; step: number;
  ids: readonly string[]; change: (tags: Tags, v: number) => Tags; format: (v: number) => string;
}) {
  const dragging = useRef(false);
  const begin = () => {
    if (dragging.current) return;
    dragging.current = true;
    useEditor.getState().beginGesture();
  };
  const end = () => { dragging.current = false; };
  return (
    <label className="field range-field">
      <span>{label} <b className="mono">{format(value)}</b></span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onPointerDown={begin} onPointerUp={end} onKeyDown={begin} onKeyUp={end} onBlur={end}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!dragging.current) { applyTags(ids, (t) => change(t, v)); return; }
          useEditor.getState().applyLive((d) => retag(d, ids, (t) => change(t, v)));
        }}
      />
    </label>
  );
}

const num = (v: string) => Number.parseFloat(v.replace(',', '.'));

/** Height of one building or of several at once (they all get the same height). */
export function BuildingHeightFields({ ids, tags }: { ids: readonly string[]; tags: Tags }) {
  const h = buildingHeight(tags);
  const many = ids.length > 1;
  return (
    <>
      <LiveRange
        label={many ? 'Высота всем' : 'Высота'} value={Math.round(h.height)} min={3} max={150} step={1} ids={ids}
        change={(t, v) => withBuildingHeight(t, v)} format={(v) => `${v} м`}
      />
      <div className="row">
        <TextField label="Высота, м" type="number" value={many ? '' : formatMetres(h.height)} placeholder={many ? 'всем' : undefined}
          onCommit={(v) => { if (Number.isFinite(num(v))) applyTags(ids, (t) => withBuildingHeight(t, num(v))); }} />
        <TextField label="Этажей" type="number" value={many ? '' : String(h.levels)} placeholder={many ? 'всем' : undefined}
          onCommit={(v) => { if (Number.isFinite(num(v))) applyTags(ids, (t) => withBuildingLevels(t, num(v))); }} />
        <TextField label="Низ, м" type="number" value={many ? '' : formatMetres(h.minHeight)} placeholder={many ? 'всем' : '0'}
          onCommit={(v) => applyTags(ids, (t) => withMinHeight(t, Number.isFinite(num(v)) ? num(v) : 0))} />
      </div>
      <p className="hint">
        {h.known || many ? '' : 'Высота в файле не указана, показана условная: 9 м. '}
        Этаж считается за 3 м. «Низ» поднимает здание над землёй: арка, навес, переход. Пишется в теги height, building:levels и min_height.
        {` Предел ${MAX_BUILDING_HEIGHT} м.`}
      </p>
    </>
  );
}

const KIND_OPTIONS: ReadonlyArray<[RoadLevelKind, string]> = [['ground', 'На земле'], ['bridge', 'Мост'], ['tunnel', 'Тоннель']];

const levelText = (layer: number) => {
  if (layer === 0) return 'на земле';
  const m = Math.abs(layer) * LAYER_STEP;
  return layer > 0 ? `уровень ${layer} · ≈${m} м над землёй` : `уровень ${layer} · ≈${m} м под землёй`;
};

/** Where one road or several run: on the ground, on a bridge or in a tunnel, and how high. */
export function RoadLevelFields({ ids, tags }: { ids: readonly string[]; tags: Tags }) {
  const level = roadLevel(tags);
  return (
    <>
      <div className="seg seg-wide" role="radiogroup" aria-label="Где проходит дорога">
        {KIND_OPTIONS.map(([k, label]) => (
          <button key={k} role="radio" aria-checked={level.kind === k} className={level.kind === k ? 'on' : ''}
            onClick={() => applyTags(ids, (t) => withRoadKind(t, k))}>{label}</button>
        ))}
      </div>
      <LiveRange
        label="Уровень" value={level.layer} min={MIN_LAYER} max={MAX_LAYER} step={1} ids={ids}
        change={(t, v) => withRoadLayer(t, v)} format={levelText}
      />
      <p className="hint">Пишется стандартными тегами bridge, tunnel и layer: их понимают SUMO, MATSim и Webots. В 3D мост поднят на {LAYER_STEP} м за каждый уровень.</p>
    </>
  );
}
