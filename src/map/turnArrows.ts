import type { Map as MapLibreMap } from 'maplibre-gl';
import type { TurnGroup } from './lanesGeo';

/**
 * Road arrows painted on the lanes before a junction, one image per set of turns
 * (`turn-arrow:left-through`). They are drawn on demand, when the map first asks for one.
 * The arrow points up, the way traffic goes; the map turns it along the lane.
 */

const PREFIX = 'turn-arrow:';
/** Drawn at four device pixels per CSS pixel, so arrows stay sharp when the map is close in. */
const RATIO = 4;
const W = 40;
const H = 72;
const SHAFT = 6;
const HEAD = 9;

type Ctx = CanvasRenderingContext2D;

function head(ctx: Ctx, x: number, y: number, angle: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, -HEAD);
  ctx.lineTo(HEAD, HEAD * 0.6);
  ctx.lineTo(-HEAD, HEAD * 0.6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Shafts first, then heads, so the outline of one never crosses the fill of another. */
function drawGroups(ctx: Ctx, groups: readonly TurnGroup[]) {
  const cx = W / 2;
  const fork = H * 0.5;
  ctx.beginPath();
  ctx.moveTo(cx, H - 4);
  ctx.lineTo(cx, fork);
  if (groups.includes('through')) { ctx.moveTo(cx, fork); ctx.lineTo(cx, 16); }
  if (groups.includes('left')) { ctx.moveTo(cx, fork + 4); ctx.quadraticCurveTo(cx, fork - 12, 12, fork - 12); }
  if (groups.includes('right')) { ctx.moveTo(cx, fork + 4); ctx.quadraticCurveTo(cx, fork - 12, W - 12, fork - 12); }
  if (groups.includes('uturn')) { ctx.moveTo(cx, fork + 2); ctx.bezierCurveTo(cx, fork - 22, 8, fork - 22, 8, fork + 6); }
  ctx.stroke();
  if (groups.includes('through')) head(ctx, cx, 12, 0);
  if (groups.includes('left')) head(ctx, 9, fork - 12, -Math.PI / 2);
  if (groups.includes('right')) head(ctx, W - 9, fork - 12, Math.PI / 2);
  if (groups.includes('uturn')) head(ctx, 8, fork + 10, Math.PI);
}

/** One arrow image: a dark outline under a white arrow, so it reads on asphalt and on colour. */
export function turnArrowImage(groups: readonly TurnGroup[]): ImageData | null {
  const canvas = document.createElement('canvas');
  canvas.width = W * (RATIO / 2);
  canvas.height = H * (RATIO / 2);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(RATIO / 2, RATIO / 2);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Outline pass, then the white arrow on top.
  ctx.strokeStyle = 'rgba(20, 16, 12, 0.75)';
  ctx.fillStyle = 'rgba(20, 16, 12, 0.75)';
  ctx.lineWidth = SHAFT + 4;
  drawGroups(ctx, groups);
  ctx.strokeStyle = '#FFFFFF';
  ctx.fillStyle = '#FFFFFF';
  ctx.lineWidth = SHAFT;
  drawGroups(ctx, groups);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** CSS pixel height of an arrow image; the map scales it to the lane's length on screen. */
export const TURN_ARROW_HEIGHT = H / 2;

/** Draws arrow images when a layer asks for one the map does not have yet. */
export function provideTurnArrows(map: MapLibreMap): void {
  map.on('styleimagemissing', (e: { id: string }) => {
    if (!e.id.startsWith(PREFIX) || map.hasImage(e.id)) return;
    const groups = e.id.slice(PREFIX.length).split('-').filter((g): g is TurnGroup => ['left', 'through', 'right', 'uturn'].includes(g));
    const image = turnArrowImage(groups);
    if (image) map.addImage(e.id, image, { pixelRatio: RATIO });
  });
}
