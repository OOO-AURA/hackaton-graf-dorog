import { buildNetwork, metres } from '../macro/model';
import { direction } from './tags';
import type { OsmDoc } from './types';

const R = 6378137;
/** Web Mercator, metres; MATSim needs a projected system and this one needs no zone. */
const mercator = (lon: number, lat: number): [number, number] => [
  (R * lon * Math.PI) / 180,
  R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)),
];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** MATSim network.xml (network_v2) built from the same directed graph the macro model uses. */
export function toMatsimNetwork(doc: OsmDoc): string {
  const net = buildNetwork(doc);
  const used = new Set<number>();
  net.links.forEach((l) => { used.add(l.from); used.add(l.to); });
  const nodes = [...used].sort((a, b) => a - b).map((i) => {
    const [x, y] = mercator(...net.lonlat[i]);
    return `    <node id="${esc(net.nodeIds[i])}" x="${x.toFixed(2)}" y="${y.toFixed(2)}"/>`;
  });
  const links = net.links.map((l, k) => {
    const tags = doc.ways[l.wayId]?.tags ?? {};
    const total = parseInt(tags.lanes ?? '', 10);
    const lanes = Number.isFinite(total) && total > 0 ? (direction(tags) === 'both' ? Math.max(1, total / 2) : total) : 1;
    const length = Math.max(1, metres(l.coords[0], l.coords[1]));
    return `    <link id="${k}" from="${esc(net.nodeIds[l.from])}" to="${esc(net.nodeIds[l.to])}" length="${length.toFixed(2)}" freespeed="${(length / l.t0).toFixed(2)}" capacity="${Math.round(l.cap)}" permlanes="${lanes}" oneway="1" modes="car">
      <attributes><attribute name="osm:way:id" class="java.lang.String">${esc(l.wayId)}</attribute></attributes>
    </link>`;
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE network SYSTEM "http://www.matsim.org/files/dtd/network_v2.dtd">',
    '<network>',
    '  <attributes><attribute name="coordinateReferenceSystem" class="java.lang.String">EPSG:3857</attribute></attributes>',
    '  <nodes>', ...nodes, '  </nodes>',
    '  <links capperiod="01:00:00" effectivecellsize="7.5" effectivelanewidth="3.75">', ...links, '  </links>',
    '</network>', '',
  ].join('\n');
}
