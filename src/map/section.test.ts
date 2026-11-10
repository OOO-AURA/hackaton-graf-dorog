import { parseOsm } from '../osm/parse';
import { roadsGeoJson } from './geojson';
import { laneLines, type LaneStyle } from './lanesGeo';
import { blend, edgesOf, roadTapers, sectionAt, sectionOf, taperBreaks } from './section';

const STYLE: LaneStyle = { load: () => null, color: () => '#fff' };
const tag = (tags: Record<string, string>) => Object.entries(tags).map(([k, v]) => `<tag k="${k}" v="${v}"/>`).join('');

/** Two roads 200 m each along a parallel, end to end at node 2, plus any extra ways. */
const joint = (a: Record<string, string>, b: Record<string, string>, extra = '') => parseOsm(`<osm version="0.6">
  <node id="1" lat="52.0" lon="104.000"/><node id="2" lat="52.0" lon="104.003"/><node id="3" lat="52.0" lon="104.006"/>
  <node id="4" lat="52.001" lon="104.003"/>
  <way id="10"><nd ref="1"/><nd ref="2"/>${tag(a)}</way>
  <way id="11"><nd ref="2"/><nd ref="3"/>${tag(b)}</way>${extra}</osm>`);

const oneway = (lanes: number) => ({ highway: 'primary', oneway: 'yes', lanes: String(lanes) });

describe('cross-sections', () => {
  test('a two-way road with more lanes one way lies off-centre of its line', () => {
    expect(edgesOf(sectionOf({ highway: 'primary', lanes: '5' }))).toEqual({ left: 3 * 3.5, right: 2 * 3.5 });
    expect(edgesOf(sectionOf(oneway(3)))).toEqual({ left: 5.25, right: 5.25 });
  });

  test('a lane that ends merges into its neighbour, and the marking between them stops', () => {
    const wide = sectionOf(oneway(3));
    const narrow = sectionOf(oneway(2));
    const end = blend(wide, narrow, 1);
    expect(end.lanes.map((l) => l.offset)).toEqual([1.75, -1.75, -1.75]);
    expect(end.dividers.map((m) => m.offset)).toEqual([0]);
    expect(end.left + end.right).toBeCloseTo(7);
    expect(blend(wide, narrow, 0).dividers).toHaveLength(2);
  });
});

describe('tapers', () => {
  test('a road narrows into the next one before the joint', () => {
    const tapers = roadTapers(joint(oneway(3), oneway(2)));
    expect([...tapers.keys()]).toEqual(['10']);
    const [t] = tapers.get('10')!;
    expect(t.atStart).toBe(false);
    expect(t.length).toBeGreaterThanOrEqual(10);
    const base = sectionOf(oneway(3));
    const total = 205;
    const width = (d: number) => { const s = sectionAt(base, tapers.get('10'), d, total); return s.left + s.right; };
    expect(width(total - t.length - 1)).toBeCloseTo(10.5);
    expect(width(total)).toBeCloseTo(7);
    // Narrowing all the way, never stepping back out.
    const widths = taperBreaks(tapers.get('10'), total).map(width);
    widths.slice(1).forEach((w, i) => expect(w).toBeLessThanOrEqual(widths[i] + 1e-9));
  });

  test('also when the narrower road is drawn the other way', () => {
    const doc = parseOsm(`<osm version="0.6">
      <node id="1" lat="52.0" lon="104.000"/><node id="2" lat="52.0" lon="104.003"/><node id="3" lat="52.0" lon="104.006"/>
      <way id="10"><nd ref="1"/><nd ref="2"/>${tag({ highway: 'primary', lanes: '6' })}</way>
      <way id="11"><nd ref="3"/><nd ref="2"/>${tag({ highway: 'primary', lanes: '4', 'lanes:forward': '1', 'lanes:backward': '3' })}</way></osm>`);
    const [t] = roadTapers(doc).get('10')!;
    // Way 11 runs against way 10, so its backward lanes go way 10's forward direction.
    expect(t.to).toMatchObject({ forward: 3, backward: 1 });
  });

  test('where a slip road joins, but not at a crossing', () => {
    const slip = `<way id="12"><nd ref="2"/><nd ref="4"/>${tag({ highway: 'primary_link', oneway: 'yes' })}</way>`;
    expect(roadTapers(joint(oneway(3), oneway(2), slip)).has('10')).toBe(true);
    const crossing = `<way id="12"><nd ref="2"/><nd ref="4"/>${tag({ highway: 'residential' })}</way>`;
    expect(roadTapers(joint(oneway(3), oneway(2), crossing)).size).toBe(0);
  });

  test('not where lanes would appear out of nowhere', () => {
    expect(roadTapers(joint({ highway: 'primary', lanes: '4' }, oneway(2))).size).toBe(0);
    expect(roadTapers(joint(oneway(2), oneway(2))).size).toBe(0);
  });

  test('the map gets the road in pieces of shrinking width, and the merging lane bends over', () => {
    const doc = joint(oneway(3), oneway(2));
    const pieces = roadsGeoJson(doc).features.filter((f) => f.properties.id === '10');
    expect(pieces.length).toBeGreaterThan(10);
    const w = pieces.filter((f) => f.properties.taper).map((f) => Number(f.properties.w17));
    expect(Math.min(...w)).toBeLessThan(Math.max(...w));
    const lanes = laneLines(doc, STYLE).features.filter((f) => f.properties.way === '10' && f.properties.kind === 'lane');
    expect(lanes).toHaveLength(3);
    const marks = laneLines(doc, STYLE).features.filter((f) => f.properties.way === '10' && f.properties.kind === 'divider');
    // One marking goes on, the other stops where the taper starts.
    expect(marks).toHaveLength(2);
  });
});
