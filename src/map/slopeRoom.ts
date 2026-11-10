/**
 * Room beside a road on an embankment, in local metres. The earth slope of an approach to a
 * bridge runs out 1.5 m for every metre of height, up to 7.5 m at a 5 m deck; next to another
 * carriageway or a ramp that would bury the other road, lanes and all. Where the slope meets
 * another road it stops there, and the side becomes a retaining wall, as interchanges are built
 * in town.
 */

export type P2 = readonly [number, number];

/** One piece of a road: its centreline from `a` to `b` and half its carriageway width. */
export interface RoadBand {
  readonly a: P2;
  readonly b: P2;
  readonly half: number;
  /** Way the piece belongs to: a road leaves room for its own slope. */
  readonly way: string;
}

const CELL = 20;
/** Spacing of the probes along the slope. */
const PROBE_STEP = 0.5;

const key = (cx: number, cy: number) => `${cx}:${cy}`;

function distToSegment(p: P2, a: P2, b: P2): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
}

/** Road pieces by grid cell, so a probe only looks at the roads near it. */
export class BandIndex {
  private readonly cells = new Map<string, RoadBand[]>();

  constructor(bands: readonly RoadBand[]) {
    for (const band of bands) {
      const pad = band.half;
      const [x0, x1] = [Math.min(band.a[0], band.b[0]) - pad, Math.max(band.a[0], band.b[0]) + pad];
      const [y0, y1] = [Math.min(band.a[1], band.b[1]) - pad, Math.max(band.a[1], band.b[1]) + pad];
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx += 1) {
        for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy += 1) {
          const k = key(cx, cy);
          this.cells.set(k, [...(this.cells.get(k) ?? []), band]);
        }
      }
    }
  }

  /** Whether `p` lies on a road other than `way`. */
  onOtherRoad(p: P2, way: string): boolean {
    const near = this.cells.get(key(Math.floor(p[0] / CELL), Math.floor(p[1] / CELL))) ?? [];
    return near.some((b) => b.way !== way && distToSegment(p, b.a, b.b) < b.half);
  }
}

/**
 * How far out from the centreline at `p`, along the unit direction `dir`, the slope of `way` may
 * reach: `to` when nothing is in the way, else the distance to the first other road met after
 * the carriageway edge `from` (`from` itself when the other road touches the edge).
 */
export function slopeReach(index: BandIndex, way: string, p: P2, dir: P2, from: number, to: number): number {
  for (let t = from; t < to; t += PROBE_STEP) {
    if (index.onOtherRoad([p[0] + dir[0] * t, p[1] + dir[1] * t], way)) return t;
  }
  return to;
}
