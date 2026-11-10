import { parseOsm } from '../osm/parse';
import { dividerOffsets, junctionGeometry, laneLines, zebras, type LaneStyle } from './lanesGeo';

const osm = (body: string) => parseOsm(`<osm version="0.6">${body}</osm>`);
const STYLE: LaneStyle = { load: () => null, color: () => '#fff' };

/** A straight road 200 m long with the given tags. */
const road = (tags: Record<string, string>) => osm(`
  <node id="1" lat="52.0" lon="104.000"/><node id="2" lat="52.0" lon="104.003"/>
  <way id="10"><nd ref="1"/><nd ref="2"/>${Object.entries(tags).map(([k, v]) => `<tag k="${k}" v="${v}"/>`).join('')}</way>`);

const dividers = (tags: Record<string, string>) =>
  laneLines(road(tags), STYLE).features.filter((f) => f.properties.kind === 'divider');

describe('lane markings', () => {
  test('a two-way road has a solid centre line and dashed lines between lanes of one direction', () => {
    const marks = dividerOffsets({ highway: 'primary', lanes: '4' });
    expect(marks).toEqual([
      { offset: 0, solid: true },
      { offset: -3.5, solid: false },
      { offset: 3.5, solid: false },
    ]);
  });

  test('a one-way road has dashed lines only, centred on the way', () => {
    const marks = dividerOffsets({ highway: 'primary', oneway: 'yes', lanes: '3' });
    expect(marks.map((m) => m.offset)).toEqual([1.75, -1.75]);
    expect(marks.every((m) => !m.solid)).toBe(true);
  });

  test('a road of one lane has no markings', () => {
    expect(dividerOffsets({ highway: 'service', oneway: 'yes' })).toEqual([]);
  });

  test('the map gets a line for every marking, apart from the lane lines', () => {
    const all = laneLines(road({ highway: 'primary', lanes: '4' }), STYLE).features;
    expect(all.filter((f) => f.properties.kind === 'lane')).toHaveLength(4);
    expect(dividers({ highway: 'primary', lanes: '4' })).toHaveLength(3);
    expect(dividers({ highway: 'primary', lanes: '4' }).filter((f) => f.properties.solid)).toHaveLength(1);
  });

  test('markings of a bridge are flagged, so 3D can draw them on the deck instead', () => {
    expect(dividers({ highway: 'primary', lanes: '2', bridge: 'yes', layer: '1' }).every((f) => f.properties.raised)).toBe(true);
    expect(dividers({ highway: 'primary', lanes: '2' }).some((f) => f.properties.raised)).toBe(false);
  });

  test('lane lines know whether the flows gave them a load', () => {
    const loaded: LaneStyle = { load: () => 0.8, color: () => '#f00' };
    expect(laneLines(road({ highway: 'primary', lanes: '2' }), loaded).features.find((f) => f.properties.kind === 'lane')?.properties.loaded).toBe(true);
    expect(laneLines(road({ highway: 'primary', lanes: '2' }), STYLE).features.find((f) => f.properties.kind === 'lane')?.properties.loaded).toBe(false);
  });
});

describe('junction drawing', () => {
  /** A four-way junction of two-way roads with two lanes each, at node 5. */
  const CROSS = osm(`
    <node id="1" lat="52.0005" lon="104.0000"/><node id="2" lat="51.9995" lon="104.0000"/>
    <node id="3" lat="52.0000" lon="103.9992"/><node id="4" lat="52.0000" lon="104.0008"/>
    <node id="5" lat="52.0000" lon="104.0000"/>
    <way id="10"><nd ref="1"/><nd ref="5"/><nd ref="2"/><tag k="highway" v="secondary"/><tag k="lanes" v="2"/></way>
    <way id="11"><nd ref="3"/><nd ref="5"/><nd ref="4"/><tag k="highway" v="secondary"/><tag k="lanes" v="2"/></way>`);
  const geo = () => junctionGeometry(CROSS, ['5'], null, STYLE);

  test('every movement is a ribbon of its turn group and lane width', () => {
    const { links } = geo();
    const groups = new Set(links.features.map((f) => f.properties.group));
    expect(groups).toEqual(new Set(['through', 'left', 'right']));
    expect(links.features.every((f) => Number(f.properties.w17) > 5)).toBe(true);
  });

  test('the junction gets an outline and an arrow on every lane coming in, but no stop line without a light', () => {
    const { areas, stops, arrows } = geo();
    expect(areas.features).toHaveLength(1);
    expect(areas.features[0].geometry.type).toBe('Polygon');
    expect(stops.features).toHaveLength(0);
    expect(arrows.features).toHaveLength(4);
    // One lane per direction takes every turn the junction offers.
    expect(arrows.features[0].properties.icon).toBe('turn-arrow:left-through-right');
  });

  test('a junction with a traffic light has a stop line on every approach', () => {
    const lit = { ...CROSS, nodes: { ...CROSS.nodes, '5': { ...CROSS.nodes['5'], tags: { highway: 'traffic_signals' } } } };
    const { stops } = junctionGeometry(lit, ['5'], null, STYLE);
    expect(stops.features).toHaveLength(4);
    expect(stops.features.every((f) => f.properties.kind === 'stop')).toBe(true);
  });

  test('a crossing on a road is a zebra across it, as wide as the road', () => {
    const doc = osm(`
      <node id="1" lat="52.0" lon="104.000"/><node id="2" lat="52.0" lon="104.001"/><node id="3" lat="52.0" lon="104.002"/>
      <node id="9" lat="52.0" lon="104.001"><tag k="highway" v="crossing"/></node>
      <way id="10"><nd ref="1"/><nd ref="9"/><nd ref="3"/><tag k="highway" v="secondary"/><tag k="lanes" v="2"/></way>`);
    const z = zebras(doc).features;
    expect(z).toHaveLength(1);
    const [[, latA], [, latB]] = z[0].geometry.coordinates;
    // The road runs east, so the zebra runs north to south, 7 m of carriageway and a margin.
    expect(Math.abs(latA - latB) * 111_000).toBeGreaterThan(7);
    expect(Math.abs(latA - latB) * 111_000).toBeLessThan(10);
  });
});

describe('lane arrows stay on the road', () => {
  test('a short link into a junction gets no arrow, the long roads do', () => {
    // Node 5 is a junction of a long road (1-5-2) and a 12 m link from node 6.
    const doc = osm(`
      <node id="1" lat="52.0" lon="103.998"/><node id="5" lat="52.0" lon="104.000"/><node id="2" lat="52.0" lon="104.002"/>
      <node id="6" lat="52.000108" lon="104.000"/>
      <way id="10"><nd ref="1"/><nd ref="5"/><nd ref="2"/><tag k="highway" v="secondary"/><tag k="lanes" v="2"/></way>
      <way id="11"><nd ref="6"/><nd ref="5"/><tag k="highway" v="secondary_link"/><tag k="oneway" v="yes"/></way>`);
    const { arrows } = junctionGeometry(doc, ['5'], null, STYLE);
    expect(arrows.features.length).toBe(2);
    // Both on the long road, at most a lane width from its axis, not out on the link.
    expect(arrows.features.every((f) => Math.abs(f.geometry.coordinates[1] - 52) * 111_320 < 3.5)).toBe(true);
  });
});

describe('lanes for route vehicles and taxis', () => {
  test('the bus lane is flagged, and the line next to it is solid', () => {
    const doc = osm(`
      <node id="1" lat="52.0" lon="104.000"/><node id="2" lat="52.0" lon="104.003"/>
      <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="primary"/><tag k="oneway" v="yes"/><tag k="lanes" v="3"/><tag k="psv:lanes" v="yes|yes|designated"/></way>`);
    const all = laneLines(doc, STYLE).features;
    const lanes = all.filter((f) => f.properties.kind === 'lane');
    expect(lanes.filter((f) => f.properties.psv)).toHaveLength(1);
    const marks = all.filter((f) => f.properties.kind === 'divider');
    expect(marks.filter((f) => f.properties.bus && f.properties.solid)).toHaveLength(1);
    expect(marks.filter((f) => !f.properties.solid)).toHaveLength(1);
  });
});
