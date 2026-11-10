import type { Map as MapLibreMap } from 'maplibre-gl';
import type { SignKind } from '../osm/signs';

/**
 * Road sign images in the look of GOST R 52290: 2.4 give way, 2.5 stop, 2.1 main road and 5.19.1
 * pedestrian crossing. Drawn once on a canvas; the map shows them in 2D next to the road.
 */

const SIZE = 48;
const RATIO = 2;
const RED = '#D7261E';
const BLUE = '#1E5BB8';
const YELLOW = '#F6C31B';
const INK = '#1A1A1A';

type Ctx = CanvasRenderingContext2D;

function giveWay(ctx: Ctx) {
  const tri = (inset: number) => {
    ctx.beginPath();
    ctx.moveTo(4 + inset, 6 + inset * 0.6);
    ctx.lineTo(SIZE - 4 - inset, 6 + inset * 0.6);
    ctx.lineTo(SIZE / 2, SIZE - 4 - inset * 1.2);
    ctx.closePath();
  };
  ctx.fillStyle = '#fff'; tri(0); ctx.fill();
  ctx.fillStyle = RED; tri(1.5); ctx.fill();
  ctx.fillStyle = '#fff'; tri(7); ctx.fill();
}

function stop(ctx: Ctx) {
  const ring = (r: number) => {
    ctx.beginPath();
    for (let i = 0; i < 8; i += 1) {
      const a = Math.PI / 8 + (i * Math.PI) / 4;
      const [x, y] = [SIZE / 2 + r * Math.cos(a), SIZE / 2 + r * Math.sin(a)];
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
  };
  ctx.fillStyle = '#fff'; ring(22); ctx.fill();
  ctx.fillStyle = RED; ring(20); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 13px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('STOP', SIZE / 2, SIZE / 2 + 1);
}

function mainRoad(ctx: Ctx) {
  const diamond = (r: number) => {
    ctx.beginPath();
    ctx.moveTo(SIZE / 2, SIZE / 2 - r); ctx.lineTo(SIZE / 2 + r, SIZE / 2); ctx.lineTo(SIZE / 2, SIZE / 2 + r); ctx.lineTo(SIZE / 2 - r, SIZE / 2);
    ctx.closePath();
  };
  ctx.fillStyle = INK; diamond(22); ctx.fill();
  ctx.fillStyle = '#fff'; diamond(20.5); ctx.fill();
  ctx.fillStyle = YELLOW; diamond(14); ctx.fill();
}

function crossing(ctx: Ctx) {
  ctx.fillStyle = '#fff';
  ctx.fillRect(2, 2, SIZE - 4, SIZE - 4);
  ctx.fillStyle = BLUE;
  ctx.fillRect(4, 4, SIZE - 8, SIZE - 8);
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.moveTo(SIZE / 2, 8); ctx.lineTo(SIZE - 8, SIZE - 10); ctx.lineTo(8, SIZE - 10); ctx.closePath(); ctx.fill();
  // A walking figure on zebra stripes.
  ctx.fillStyle = INK;
  for (let i = 0; i < 4; i += 1) ctx.fillRect(14 + i * 5.5, SIZE - 15, 3.5, 3);
  ctx.beginPath(); ctx.arc(SIZE / 2 + 1, 18, 2.6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(SIZE / 2, 22); ctx.lineTo(SIZE / 2 - 1, 29);
  ctx.moveTo(SIZE / 2 - 1, 29); ctx.lineTo(SIZE / 2 - 5, 34);
  ctx.moveTo(SIZE / 2 - 1, 29); ctx.lineTo(SIZE / 2 + 4, 34);
  ctx.moveTo(SIZE / 2 - 4, 25); ctx.lineTo(SIZE / 2 + 4, 24);
  ctx.stroke();
}

const DRAW: Readonly<Record<SignKind, (ctx: Ctx) => void>> = { give_way: giveWay, stop, main_road: mainRoad, crossing };

export const signImageId = (sign: SignKind) => `road-sign-${sign}`;

export function addRoadSignImages(map: MapLibreMap): void {
  (Object.keys(DRAW) as SignKind[]).forEach((sign) => {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE * RATIO;
    canvas.height = SIZE * RATIO;
    const ctx = canvas.getContext('2d');
    if (!ctx || map.hasImage(signImageId(sign))) return;
    ctx.scale(RATIO, RATIO);
    DRAW[sign](ctx);
    map.addImage(signImageId(sign), ctx.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: RATIO * 2 });
  });
}
