import { armLabel, isJunction, junctionArms, junctionTurns, restrictionsAt, setTurnAllowed, turnAllowed } from './turns';
import { parseOsm } from './parse';
import { serializeOsm } from './serialize';

/**
 * Cross junction at node 2. Way 10 runs west → east through it (1 → 2 → 3),
 * way 12 comes from the south (4 → 2), way 13 leaves to the north (2 → 5) and is one-way.
 */
const XML = `<osm version="0.6">
  <node id="1" lat="52.0000" lon="104.0000"/><node id="2" lat="52.0000" lon="104.0030"/><node id="3" lat="52.0000" lon="104.0060"/>
  <node id="4" lat="51.9980" lon="104.0030"/><node id="5" lat="52.0020" lon="104.0030"/>
  <way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><tag k="highway" v="primary"/><tag k="name" v="Лермонтова"/></way>
  <way id="12"><nd ref="4"/><nd ref="2"/><tag k="highway" v="secondary"/><tag k="name" v="Игошина"/></way>
  <way id="13"><nd ref="2"/><nd ref="5"/><tag k="highway" v="secondary"/><tag k="oneway" v="yes"/><tag k="name" v="Игошина"/></way>
</osm>`;

describe('junction turns', () => {
  const doc = parseOsm(XML);
  const arms = junctionArms(doc, '2');
  const arm = (wayId: string, side: string) => arms.find((a) => a.wayId === wayId && a.side === side)!;

  test('arms with compass bearings and one-way rules', () => {
    expect(arms.map((a) => [a.key, Math.round(a.bearing)])).toEqual([['10:before', 270], ['10:after', 90], ['12:end', 180], ['13:start', 0]]);
    expect(arm('13', 'start')).toMatchObject({ canEnter: false, canExit: true });
    expect(armLabel(arm('12', 'end'))).toBe('Игошина, Ю');
    expect(isJunction(doc, '2')).toBe(true);
    expect(isJunction(doc, '1')).toBe(false);
  });

  test('turn kinds seen from the driver', () => {
    const kinds = Object.fromEntries(junctionTurns(doc, '2').filter((t) => t.from.key === '10:before').map((t) => [t.to.key, t.kind]));
    // Coming from the west, heading east: north is left, south is right.
    expect(kinds).toEqual({ '10:before': 'uturn', '10:after': 'straight', '12:end': 'right', '13:start': 'left' });
    expect(junctionTurns(doc, '2').some((t) => t.from.wayId === '13')).toBe(false);
  });

  test('forbidding a left turn splits the through road and writes a standard restriction', () => {
    const d = setTurnAllowed(doc, '2', arm('10', 'before'), arm('13', 'start'), false);
    expect(d.ways['10'].refs).toEqual(['1', '2']);
    const [rel] = restrictionsAt(d, '2');
    expect(rel.tags).toEqual({ type: 'restriction', restriction: 'no_left_turn' });
    expect(rel.members).toEqual([{ type: 'way', ref: '10', role: 'from' }, { type: 'node', ref: '2', role: 'via' }, { type: 'way', ref: '13', role: 'to' }]);
    expect(turnAllowed(d, '2', '10', '13')).toBe(false);
    expect(turnAllowed(d, '2', '10', '12')).toBe(true);
    expect(serializeOsm(d)).toContain('<tag k="restriction" v="no_left_turn"/>');
  });

  test('both sides of a through road can be used in one turn', () => {
    const d = setTurnAllowed(doc, '2', arm('10', 'before'), arm('10', 'after'), false);
    const [rel] = restrictionsAt(d, '2');
    const to = rel.members.find((m) => m.role === 'to')!.ref;
    expect(rel.tags.restriction).toBe('no_straight_on');
    expect(to).not.toBe('10');
    expect(d.ways[to].refs).toEqual(['2', '3']);
  });

  test('allowing the turn again removes the restriction', () => {
    const banned = setTurnAllowed(doc, '2', arm('10', 'before'), arm('13', 'start'), false);
    const back = setTurnAllowed(banned, '2', junctionArms(banned, '2').find((a) => a.wayId === '10' && a.side === 'end')!, junctionArms(banned, '2').find((a) => a.wayId === '13')!, true);
    expect(restrictionsAt(back, '2')).toHaveLength(0);
    expect(serializeOsm(back)).not.toContain('restriction');
  });

  test('an only_ restriction is read and expanded to no_ restrictions when edited', () => {
    const only = XML.replace('</osm>', `<relation id="90"><member type="way" ref="12" role="from"/><member type="node" ref="2" role="via"/><member type="way" ref="13" role="to"/><tag k="type" v="restriction"/><tag k="restriction" v="only_straight_on"/></relation></osm>`);
    const d = parseOsm(only);
    expect(turnAllowed(d, '2', '12', '13')).toBe(true);
    expect(turnAllowed(d, '2', '12', '10')).toBe(false);
    const south = junctionArms(d, '2').find((a) => a.wayId === '12')!;
    const north = junctionArms(d, '2').find((a) => a.wayId === '13')!;
    const edited = setTurnAllowed(d, '2', south, north, false);
    expect(restrictionsAt(edited, '2').every((r) => r.tags.restriction.startsWith('no_'))).toBe(true);
    expect(turnAllowed(edited, '2', '12', '13')).toBe(false);
    expect(edited.relations['90']).toBeUndefined();
  });
});
