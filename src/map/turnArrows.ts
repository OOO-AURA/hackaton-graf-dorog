import type { Map as MapLibreMap } from 'maplibre-gl';
import type { TurnGroup } from './lanesGeo';

/**
 * Road arrows painted on the lanes before a junction (marking 1.18 of GOST R 51256), one image
 * per set of turns (`turn-arrow:left-through`). Drawn as the marking is laid on the road: a thin
 * shaft and a long narrow head for straight on, turns bending off the shaft in a smooth curve with
 * a shorter head, U-turn as a hook. White, with only a soft dark edge so they read on any road.
 * The arrow points up, the way traffic goes; the map lays it flat along the lane, 5 m long.
 */

const PREFIX = 'turn-arrow:';
/** Image pixels per metre of road. */
const PX = 48;
/** Device pixels per CSS pixel the image is drawn at, so it stays sharp close in. */
const RATIO = 4;
/** The image covers this much road around the arrow, metres: x from −HALF_W to HALF_W, y from −MARGIN to LENGTH + MARGIN. */
const HALF_W = 1.25;
const MARGIN = 0.1;
/** Length of the marking, metres. */
export const ARROW_LENGTH = 5;

/** Shaft width, the straight head's length and width, a turn head's length and width, metres. */
const SHAFT = 0.2;
const HEAD_L = 1.4;
const HEAD_W = 0.72;
const TURN_HEAD_L = 0.75;
const TURN_HEAD_W = 0.62;
/** How far out a turn reaches before its head starts, and how sharply it bends, metres. */
const TURN_OUT = 0.32;
const BEND = 0.95;

type Ctx = CanvasRenderingContext2D;
type P = [number, number];

/** A triangle head with its tip at `tip`, pointing along unit `dir`. */
function head(ctx: Ctx, tip: P, dir: P, length: number, width: number) {
  const base: P = [tip[0] - dir[0] * length, tip[1] - dir[1] * length];
  const across: P = [-dir[1] * (width / 2), dir[0] * (width / 2)];
  ctx.beginPath();
  ctx.moveTo(...tip);
  ctx.lineTo(base[0] + across[0], base[1] + across[1]);
  ctx.lineTo(base[0] - across[0], base[1] - across[1]);
  ctx.closePath();
  ctx.fill();
}

/** The marking in metres, y up from the arrow's back end. */
function drawArrow(ctx: Ctx, groups: readonly TurnGroup[]) {
  const through = groups.includes('through');
  // Turns branch off low on a combined arrow and high on a turn-only one, so all are 5 m long.
  const fork = through ? 1.5 : 2.9;
  const level = fork + BEND;
  ctx.lineWidth = SHAFT;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, through ? ARROW_LENGTH - HEAD_L + 0.05 : fork);
  for (const side of [-1, 1] as const) {
    if (!groups.includes(side < 0 ? 'left' : 'right')) continue;
    ctx.moveTo(0, fork);
    ctx.quadraticCurveTo(0, level, side * TURN_OUT, level);
    ctx.lineTo(side * (TURN_OUT + 0.08), level);
  }
  // With a left turn too, the U-turn hooks back lower down, under it.
  const uFork = groups.includes('left') ? fork - 1.3 : fork;
  const uLevel = uFork + BEND;
  if (groups.includes('uturn')) {
    const r = 0.42;
    ctx.moveTo(0, uFork);
    ctx.lineTo(0, uLevel);
    ctx.arc(-r, uLevel, r, 0, Math.PI, false);
    ctx.lineTo(-2 * r, uFork - 0.1);
  }
  ctx.stroke();
  if (through) head(ctx, [0, ARROW_LENGTH], [0, 1], HEAD_L, HEAD_W);
  for (const side of [-1, 1] as const) {
    if (groups.includes(side < 0 ? 'left' : 'right')) head(ctx, [side * (TURN_OUT + TURN_HEAD_L), level], [side, 0], TURN_HEAD_L, TURN_HEAD_W);
  }
  if (groups.includes('uturn')) head(ctx, [-0.84, uFork - 0.1 - TURN_HEAD_L], [0, -1], TURN_HEAD_L, TURN_HEAD_W);
}

/** One arrow image: white marking with a soft dark edge. */
export function turnArrowImage(groups: readonly TurnGroup[]): ImageData | null {
  const w = Math.round(HALF_W * 2 * PX);
  const h = Math.round((ARROW_LENGTH + 2 * MARGIN) * PX);
  const shape = document.createElement('canvas');
  shape.width = w;
  shape.height = h;
  const s = shape.getContext('2d');
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!s || !ctx) return null;
  // Metres, y up, origin at the back end of the arrow in the middle.
  s.setTransform(PX, 0, 0, -PX, w / 2, h - MARGIN * PX);
  s.fillStyle = '#FFFFFF';
  s.strokeStyle = '#FFFFFF';
  drawArrow(s, groups);
  // The whole shape gets one soft edge, so overlapping parts do not darken where they meet.
  ctx.shadowColor = 'rgba(10, 8, 6, 0.55)';
  ctx.shadowBlur = PX * 0.06;
  ctx.drawImage(shape, 0, 0);
  return ctx.getImageData(0, 0, w, h);
}

/** CSS pixel height of an arrow image and the metres of road it covers: the map scales one to the other. */
export const TURN_ARROW_HEIGHT = (ARROW_LENGTH + 2 * MARGIN) * PX / RATIO;
export const TURN_ARROW_METRES = ARROW_LENGTH + 2 * MARGIN;

/** Draws arrow images when a layer asks for one the map does not have yet. */
export function provideTurnArrows(map: MapLibreMap): void {
  map.on('styleimagemissing', (e: { id: string }) => {
    if (!e.id.startsWith(PREFIX) || map.hasImage(e.id)) return;
    const groups = e.id.slice(PREFIX.length).split('-').filter((g): g is TurnGroup => ['left', 'through', 'right', 'uturn'].includes(g));
    const image = turnArrowImage(groups);
    if (image) map.addImage(e.id, image, { pixelRatio: RATIO });
  });
}
