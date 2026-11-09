export type LonLat = readonly [number, number];

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

export function haversine(a: LonLat, b: LonLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Local planar projection in metres; accurate enough within a city fragment. */
export function projector(originLat: number): (p: LonLat) => [number, number] {
  const k = (Math.PI / 180) * EARTH_RADIUS_M;
  const cos = Math.cos(toRad(originLat));
  return ([lon, lat]) => [lon * k * cos, lat * k];
}

/** Intersection parameter of segments p1p2 and p3p4 (planar), or null when they do not cross. */
export function segmentIntersection(
  p1: [number, number], p2: [number, number], p3: [number, number], p4: [number, number],
): { t: number; u: number } | null {
  const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (Math.abs(d) < 1e-12) return null;
  const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
  const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { t, u } : null;
}

/** Closest point on segment ab to p, as parameter t ∈ [0,1] and squared distance (planar). */
export function projectOnSegment(p: [number, number], a: [number, number], b: [number, number]): { t: number; dist2: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  const x = a[0] + t * dx - p[0];
  const y = a[1] + t * dy - p[1];
  return { t, dist2: x * x + y * y };
}
