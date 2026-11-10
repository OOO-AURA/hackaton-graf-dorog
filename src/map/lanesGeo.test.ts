import { parseOsm } from '../osm/parse';
import { dividerOffsets, laneLines, type LaneStyle } from './lanesGeo';

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
