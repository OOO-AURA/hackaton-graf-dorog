/**
 * Bridges and tunnels as the Webots importer sees them.
 *
 * Webots raises a whole way by `layer × 5 m` and skips every way with a negative layer
 * ("underground structure", osm_importer/parser_objects.py). A short road under an overpass is
 * often mapped as `tunnel=yes, layer=-1`, but on the ground it is a normal road: the overpass is
 * the bridge. Webots then leaves a gap in the road under the bridge, and the cars of the SUMO run
 * drive through empty space. OSM itself advises against tagging such roads as tunnels. This check
 * finds them and offers to keep the road on the ground.
 */
import { haversine, segmentIntersection, type LonLat } from './geo';
import { withTag } from './tags';
import type { OsmDoc, OsmWay, Tags } from './types';

/** Longer covered pieces are real tunnels or underpasses and are left alone. */
export const FALSE_TUNNEL_MAX_M = 120;
const METRES_PER_DEG_LAT = 110_540;
const METRES_PER_DEG_LON_EQUATOR = 111_320;

const isTunnel = (t: Tags) => Boolean(t.tunnel && t.tunnel !== 'no' && t.tunnel !== 'building_passage');
const isBridge = (t: Tags) => Boolean(t.bridge && t.bridge !== 'no');

const coords = (doc: OsmDoc, w: OsmWay): LonLat[] => w.refs.filter((r) => doc.nodes[r]).map((r) => [doc.nodes[r].lon, doc.nodes[r].lat]);
const lengthOf = (pts: LonLat[]) => pts.slice(1).reduce((s, p, i) => s + haversine(pts[i], p), 0);

function crosses(a: LonLat[], b: LonLat[]): boolean {
  const kx = METRES_PER_DEG_LON_EQUATOR * Math.cos(((a[0]?.[1] ?? 0) * Math.PI) / 180);
  const xy = ([lon, lat]: LonLat): [number, number] => [lon * kx, lat * METRES_PER_DEG_LAT];
  for (let i = 0; i < a.length - 1; i += 1) {
    for (let j = 0; j < b.length - 1; j += 1) {
      if (segmentIntersection(xy(a[i]), xy(a[i + 1]), xy(b[j]), xy(b[j + 1]))) return true;
    }
  }
  return false;
}

export interface FalseTunnel {
  readonly wayId: string;
  readonly bridgeId: string;
  readonly lengthM: number;
  readonly at: LonLat;
}

/** Short tunnels of roads that only pass under a bridge. */
export function falseTunnels(doc: OsmDoc): FalseTunnel[] {
  const ways = Object.values(doc.ways).filter((w) => (w.tags.highway || w.tags.railway) && w.refs.length > 1);
  const bridges = ways.filter((w) => isBridge(w.tags)).map((w) => ({ w, pts: coords(doc, w) }));
  return ways.filter((w) => isTunnel(w.tags)).flatMap((w) => {
    const pts = coords(doc, w);
    const lengthM = lengthOf(pts);
    if (lengthM > FALSE_TUNNEL_MAX_M) return [];
    const over = bridges.find((b) => crosses(pts, b.pts));
    return over ? [{ wayId: w.id, bridgeId: over.w.id, lengthM, at: pts[Math.floor(pts.length / 2)] }] : [];
  });
}

/** Keeps the road on the ground: drops the tunnel tag and a negative layer. */
export function groundTags(tags: Tags): Tags {
  const layer = Number.parseFloat(tags.layer ?? '');
  const noTunnel = withTag(tags, 'tunnel', null);
  return Number.isFinite(layer) && layer < 0 ? withTag(noTunnel, 'layer', null) : noTunnel;
}

/** Height in metres at which the Webots importer will put this way; null when it skips the way. */
export function webotsElevation(tags: Tags): number | null {
  const layer = Number.parseFloat(tags.layer ?? '');
  const value = Number.isFinite(layer) ? layer : 0;
  return value < 0 ? null : value * 5;
}
