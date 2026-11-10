import { parseOsm } from './parse';
import { detachWay, isolatePiece, mayJoin, pieceAround } from './pieces';

/**
 * A street 1-2-3-4-5 (way 10); a side street joins it at node 3 (way 20, 3-6).
 * A tram track 7-8 (way 30) runs nearby.
 */
const doc = parseOsm(`<osm version="0.6">
  <node id="1" lat="52.0" lon="104.000"/><node id="2" lat="52.0" lon="104.001"/><node id="3" lat="52.0" lon="104.002"/>
  <node id="4" lat="52.0" lon="104.003"/><node id="5" lat="52.0" lon="104.004"/><node id="6" lat="52.001" lon="104.002"/>
  <node id="7" lat="51.999" lon="104.000"/><node id="8" lat="51.999" lon="104.004"/>
  <way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><nd ref="5"/><tag k="highway" v="secondary"/><tag k="name" v="Лермонтова"/></way>
  <way id="20"><nd ref="3"/><nd ref="6"/><tag k="highway" v="residential"/></way>
  <way id="30"><nd ref="7"/><nd ref="8"/><tag k="railway" v="tram"/></way>
  <relation id="90"><member type="way" ref="10" role=""/><tag k="type" v="route"/><tag k="route" v="bus"/></relation>
</osm>`);

describe('stretches of a road', () => {
  test('a click between 1 and 3 picks the stretch up to the junction', () => {
    expect(pieceAround(doc, '10', 0)).toEqual({ from: 0, to: 2 });
    expect(pieceAround(doc, '10', 3)).toEqual({ from: 2, to: 4 });
  });

  test('a way with no junction along it is picked whole', () => {
    expect(pieceAround(doc, '20', 0)).toBeNull();
  });

  test('cutting a stretch out keeps the way id on it, the rest goes on as its own way', () => {
    const d = isolatePiece(doc, '10', { from: 2, to: 4 });
    expect(d.ways['10'].refs).toEqual(['3', '4', '5']);
    const rest = Object.values(d.ways).find((w) => w.id !== '10' && w.tags.name === 'Лермонтова')!;
    expect(rest.refs).toEqual(['1', '2', '3']);
    // Both parts stay on the bus route.
    expect(d.relations['90'].members.map((m) => m.ref).sort()).toEqual(['10', rest.id].sort());
  });

  test('a stretch in the middle leaves a way before and one after', () => {
    const three = parseOsm(`<osm version="0.6">
      ${[1, 2, 3, 4, 5, 6].map((i) => `<node id="${i}" lat="52.0" lon="${104 + i / 1000}"/>`).join('')}
      <node id="9" lat="52.001" lon="104.002"/><node id="11" lat="52.001" lon="104.004"/>
      <way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><nd ref="5"/><nd ref="6"/><tag k="highway" v="secondary"/></way>
      <way id="20"><nd ref="2"/><nd ref="9"/><tag k="highway" v="residential"/></way>
      <way id="21"><nd ref="4"/><nd ref="11"/><tag k="highway" v="residential"/></way></osm>`);
    const piece = pieceAround(three, '10', 2)!;
    expect(piece).toEqual({ from: 1, to: 3 });
    const d = isolatePiece(three, '10', piece);
    expect(d.ways['10'].refs).toEqual(['2', '3', '4']);
    const parts = Object.values(d.ways).filter((w) => w.tags.highway === 'secondary').map((w) => w.refs.join('-')).sort();
    expect(parts).toEqual(['1-2', '2-3-4', '4-5-6']);
  });
});

describe('junctions', () => {
  test('a road taken off a junction gets its own node a little way along it', () => {
    const { doc: d, nodeId } = detachWay(doc, '3', '20');
    expect(nodeId).not.toBe('');
    expect(d.ways['20'].refs[0]).toBe(nodeId);
    expect(d.ways['10'].refs).toContain('3');
    expect(d.nodes[nodeId].lat).toBeGreaterThan(d.nodes['3'].lat);
  });

  test('a car road does not join a tram track, roads join roads', () => {
    expect(mayJoin(doc, '5', '8')).toBe(false);
    expect(mayJoin(doc, '8', '5')).toBe(false);
    expect(mayJoin(doc, '5', '6')).toBe(true);
  });
});
