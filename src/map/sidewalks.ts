import type { Feature, FeatureCollection, LineString } from 'geojson';

/**
 * Sidewalk lines for the map. A sidewalk is the road's line moved sideways, so where a street is
 * two OSM ways meeting at a bend each piece ended square at the node: a gap outside the bend and
 * an overlap inside. Pieces of one street that meet end to end, with nothing else at that node,
 * are joined into one line here, so the bend gets a round join like a bend inside a way.
 */

type Props = Record<string, string | number | boolean>;

const KEY_DIGITS = 7;
const SAME = 0.05;

const key = (c: number[]) => `${c[0].toFixed(KEY_DIGITS)},${c[1].toFixed(KEY_DIGITS)}`;

interface Piece { coords: number[][]; sw: string; sl17: number; sr17: number; s17: number }

const flip = (p: Piece): Piece => ({
  coords: [...p.coords].reverse(),
  sw: p.sw.split('').map((s) => (s === 'l' ? 'r' : 'l')).sort().join(''),
  sl17: -p.sr17, sr17: -p.sl17, s17: p.s17,
});

const sameSides = (a: Piece, b: Piece) =>
  a.sw === b.sw && Math.abs(a.sl17 - b.sl17) < SAME && Math.abs(a.sr17 - b.sr17) < SAME && Math.abs(a.s17 - b.s17) < SAME;

export function sidewalkLines(roads: FeatureCollection<LineString, Props>): FeatureCollection<LineString, Props> {
  const pieces: Piece[] = roads.features
    .filter((f) => f.properties.sw && !f.properties.bridge && !f.properties.tunnel && !f.properties.taper && f.geometry.coordinates.length > 1)
    .map((f) => ({ coords: f.geometry.coordinates, sw: String(f.properties.sw), sl17: Number(f.properties.sl17), sr17: Number(f.properties.sr17), s17: Number(f.properties.s17) }));
  // How many road pieces of any kind end at each point: a join is only made where exactly two do.
  const ends = new Map<string, number[]>();
  const degree = new Map<string, number>();
  roads.features.forEach((f) => {
    const c = f.geometry.coordinates;
    [key(c[0]), key(c[c.length - 1])].forEach((k) => degree.set(k, (degree.get(k) ?? 0) + 1));
  });
  pieces.forEach((p, i) => {
    [key(p.coords[0]), key(p.coords[p.coords.length - 1])].forEach((k) => ends.set(k, [...(ends.get(k) ?? []), i]));
  });
  const used = new Set<number>();
  const out: Feature<LineString, Props>[] = [];
  // The other piece ending at a point, when the street just runs on there.
  const partner = (k: string, self: number) => {
    if (degree.get(k) !== 2) return null;
    const there = (ends.get(k) ?? []).filter((j) => j !== self && !used.has(j));
    return there.length === 1 ? there[0] : null;
  };
  pieces.forEach((start, i) => {
    if (used.has(i)) return;
    used.add(i);
    let chain = start;
    // Grow forwards from the end, then backwards from the start.
    for (const forward of [true, false]) {
      for (;;) {
        const tip = forward ? chain.coords[chain.coords.length - 1] : chain.coords[0];
        const j = partner(key(tip), -1);
        if (j === null) break;
        let next = pieces[j];
        const startsHere = key(next.coords[0]) === key(tip);
        // Forwards the next piece must start at the tip, backwards it must end there.
        if (forward !== startsHere) next = flip(next);
        if (!sameSides(chain, next)) break;
        used.add(j);
        chain = { ...chain, coords: forward ? [...chain.coords, ...next.coords.slice(1)] : [...next.coords.slice(0, -1), ...chain.coords] };
      }
    }
    out.push({ type: 'Feature', properties: { sw: chain.sw, sl17: chain.sl17, sr17: chain.sr17, s17: chain.s17 }, geometry: { type: 'LineString', coordinates: chain.coords } });
  });
  return { type: 'FeatureCollection', features: out };
}
