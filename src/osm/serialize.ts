import type { Attrs, OsmDoc, Tags } from './types';

const GENERATOR = 'hackaton-graf-dorog';

export const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const attrString = (attrs: Attrs) =>
  Object.entries(attrs).map(([k, v]) => ` ${k}="${escapeXml(v)}"`).join('');

const tagLines = (tags: Tags) =>
  Object.entries(tags)
    .filter(([k, v]) => k !== '' && v !== '')
    .map(([k, v]) => `  <tag k="${escapeXml(k)}" v="${escapeXml(v)}"/>`);

function element(open: string, children: string[]): string {
  return children.length ? ` <${open}>\n${children.map((c) => ` ${c}`).join('\n')}\n </${open.split(' ')[0]}>` : ` <${open}/>`;
}

/**
 * Writes the document back to OSM XML. Objects that were not edited come out exactly as they came in
 * (same ids, attributes, tags and order), so MatSim, SUMO and Webots importers see the original data plus edits.
 * Relation members pointing at objects deleted in the editor are dropped; members outside the extract are kept.
 */
export function serializeOsm(doc: OsmDoc): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(`<osm${attrString({ ...doc.rootAttrs, version: doc.rootAttrs.version ?? '0.6', generator: GENERATOR })}>`);
  if (doc.bounds) lines.push(` <bounds${attrString(doc.bounds)}/>`);

  Object.values(doc.nodes).forEach((n) => {
    lines.push(element(`node id="${n.id}"${attrString(n.attrs)} lat="${n.lat}" lon="${n.lon}"`, tagLines(n.tags)));
  });
  Object.values(doc.ways).forEach((w) => {
    const refs = w.refs.map((r) => `  <nd ref="${r}"/>`);
    lines.push(element(`way id="${w.id}"${attrString(w.attrs)}`, [...refs, ...tagLines(w.tags)]));
  });
  Object.values(doc.relations).forEach((r) => {
    const members = r.members
      .filter((m) => !doc.deleted[`${m.type}:${m.ref}`])
      .map((m) => `  <member type="${m.type}" ref="${m.ref}" role="${escapeXml(m.role)}"/>`);
    lines.push(element(`relation id="${r.id}"${attrString(r.attrs)}`, [...members, ...tagLines(r.tags)]));
  });

  lines.push('</osm>');
  return `${lines.join('\n')}\n`;
}
