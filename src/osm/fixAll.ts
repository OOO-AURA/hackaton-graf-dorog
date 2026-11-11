import { connectCrossing, flipDirection, mergeNodes, setWayTag, setWayTags } from './edit';
import { addAllCordonConnectors } from './cordon';
import { cutBuildings } from './clearance';
import { roadWidthMetres } from '../map/lanesGeo';
import { sanitizeDoc } from './pipelineSafety';
import { applyRules } from './rules';
import { applyLegalSpeeds } from './speeds';
import { groundTags } from './structures';
import type { OsmDoc } from './types';
import { validate } from './validate';

/**
 * Every fix the check offers, in one go: broken junctions joined, nearby nodes merged, false
 * tunnels grounded, Webots-breaking values repaired, flows turned the right way, cut roads closed
 * at the edge, signs by the rules and legal speeds. Fixes that change nodes go in rounds with a
 * fresh check (fixGeometry).
 */

/** Rounds of junction fixes; each one re-checks the graph. */
const MAX_ROUNDS = 8;

/** `before` and `after`: issues of the check (errors and remarks) before and after the fixes. */
export interface FixAllResult { readonly doc: OsmDoc; readonly fixed: number; readonly before: number; readonly after: number; readonly errorsAfter: number }



export function fixAll(doc: OsmDoc): FixAllResult {
  const first = validate(doc).issues;
  let d = doc;
  let fixed = 0;

  // Values and tags first: they do not move nodes.
  const once = new Set<string>();
  for (const i of first) {
    const f = i.fix;
    if (!f || f.type === 'connect' || f.type === 'merge') continue;
    const key = `${f.type}:${'wayId' in f ? f.wayId : ''}`;
    if (once.has(key)) continue; // two head-on issues on one road must not flip it back
    once.add(key);
    if (!('wayId' in f) || !d.ways[f.wayId]) continue;
    if (f.type === 'sanitize') d = sanitizeDoc(d, [f.wayId]);
    else if (f.type === 'ground') d = setWayTags(d, f.wayId, groundTags(d.ways[f.wayId].tags));
    else if (f.type === 'flip') d = flipDirection(d, f.wayId);
    else if (f.type === 'oneway') d = setWayTag(d, f.wayId, 'oneway', f.value);
    else continue; // speeds and the rules go for the whole graph below
    fixed++;
  }

  const geo = fixGeometry(d);
  d = geo.doc;
  fixed += geo.fixed;

  // Buildings under carriageways are cut back along the road, after the junctions are joined.
  // A cut replaces a building with new pieces, so each round re-checks and touches a building once.
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const used = new Set<string>();
    let done = 0;
    for (const i of validate(d).issues) {
      const f = i.fix;
      if (f?.type !== 'clear' || f.buildingIds.some((b) => used.has(b) || !d.ways[b])) continue;
      f.buildingIds.forEach((b) => used.add(b));
      d = clearAlong(d, f.wayId, f.buildingIds);
      done++;
    }
    fixed += done;
    if (!done) break;
  }

  const cordon = addAllCordonConnectors(d);
  d = cordon.doc;
  fixed += cordon.added;
  // The connectors at the edge may leave new near nodes: one more pass, then the rules sign the result.
  const geo2 = fixGeometry(d);
  d = geo2.doc;
  fixed += geo2.fixed;
  d = applyRules(d).doc;
  const speedIds = validate(d).issues.filter((i) => i.kind === 'speed').map((i) => i.wayIds[0]).filter(Boolean);
  if (speedIds.length) { d = applyLegalSpeeds(d, speedIds); fixed += speedIds.length; }
  const pdd = first.filter((i) => i.kind === 'pdd').length;
  fixed += pdd;

  const last = validate(d).issues;
  return { doc: d, fixed, before: first.length, after: last.length, errorsAfter: last.filter((i) => i.severity === 'error').length };
}

/** Cuts the buildings back along a road's carriageway, as wide as the map draws it. */
export function clearAlong(doc: OsmDoc, wayId: string, buildingIds: readonly string[]): OsmDoc {
  const way = doc.ways[wayId];
  if (!way) return doc;
  const road = way.refs.map((r) => doc.nodes[r]).filter(Boolean).map((n) => ({ lon: n.lon, lat: n.lat }));
  return cutBuildings(doc, buildingIds, road, roadWidthMetres(way.tags));
}

/**
 * Merges nodes closer than the limit and joins crossings without a node, in rounds with a fresh
 * check: a round touches each node and each way once, as a fix shifts indices along its way.
 */
function fixGeometry(doc: OsmDoc): { doc: OsmDoc; fixed: number } {
  let d = doc;
  let fixed = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const used = new Set<string>();
    let done = 0;
    for (const i of validate(d).issues) {
      const f = i.fix;
      if (f?.type === 'merge') {
        if (used.has(f.keep) || used.has(f.remove) || !d.nodes[f.keep] || !d.nodes[f.remove]) continue;
        used.add(f.keep); used.add(f.remove);
        d = mergeNodes(d, f.keep, f.remove);
        done++;
      } else if (f?.type === 'connect') {
        if (used.has(f.a.wayId) || used.has(f.b.wayId) || !d.ways[f.a.wayId] || !d.ways[f.b.wayId]) continue;
        used.add(f.a.wayId); used.add(f.b.wayId);
        d = connectCrossing(d, f.a, f.b, f.at[0], f.at[1]);
        done++;
      }
    }
    fixed += done;
    if (!done) break;
  }
  return { doc: d, fixed };
}
