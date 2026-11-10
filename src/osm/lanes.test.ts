import { parseOsm } from './parse';
import { applyJunctionTemplate, classifyTurn, junctionLanes, junctions, setApproachLanes, toggleLaneTurn } from './lanes';

/**
 * A crossroads at node 0. Ways come in from the south (1), west (2), north (3) and east (4) and
 * end at 0; two lanes each way unless a test says otherwise.
 */
const cross = (south = '', through = false) => parseOsm(`<osm version="0.6">
  <node id="0" lat="52.0000" lon="104.0000"/>
  <node id="1" lat="51.9990" lon="104.0000"/>
  <node id="2" lat="52.0000" lon="103.9985"/>
  <node id="3" lat="52.0010" lon="104.0000"/>
  <node id="4" lat="52.0000" lon="104.0015"/>
  ${through
    ? '<way id="13"><nd ref="1"/><nd ref="0"/><nd ref="3"/><tag k="highway" v="primary"/><tag k="lanes" v="4"/></way>'
    : `<way id="10"><nd ref="1"/><nd ref="0"/><tag k="highway" v="primary"/><tag k="lanes" v="4"/>${south}</way>
       <way id="30"><nd ref="3"/><nd ref="0"/><tag k="highway" v="primary"/><tag k="lanes" v="4"/></way>`}
  <way id="20"><nd ref="2"/><nd ref="0"/><tag k="highway" v="primary"/><tag k="lanes" v="4"/></way>
  <way id="40"><nd ref="4"/><nd ref="0"/><tag k="highway" v="primary"/><tag k="lanes" v="4"/></way>
</osm>`);

const fromSouth = (doc: ReturnType<typeof cross>) =>
  junctionLanes(doc, '0').approaches.find((a) => a.arm.wayId === (doc.ways['10'] ? '10' : '13') && a.arm.step === -1)!;

describe('lanes at junctions', () => {
  test('turns are classed by the change of heading', () => {
    expect(classifyTurn(0)).toBe('through');
    expect(classifyTurn(-90)).toBe('left');
    expect(classifyTurn(90)).toBe('right');
    expect(classifyTurn(40)).toBe('slight_right');
    expect(classifyTurn(-150)).toBe('sharp_left');
    expect(classifyTurn(178)).toBe('reverse');
  });

  test('the crossroads is a junction', () => {
    expect(junctions(cross())).toEqual(['0']);
  });

  test('without rules: left from the leftmost lane, right from the rightmost, straight from both', () => {
    const a = fromSouth(cross());
    expect(a.explicit).toBe(false);
    expect(a.turns).toEqual([['left', 'through'], ['through', 'right']]);
  });

  test('links go from each lane to the exits of its turns, on the same side', () => {
    const { links } = junctionLanes(cross(), '0');
    const south = links.filter((l) => l.from.wayId === '10');
    const left = south.find((l) => l.turn === 'left')!;
    const right = south.find((l) => l.turn === 'right')!;
    expect(left).toMatchObject({ fromLane: 0, toLane: 0 });
    expect(left.to.wayId).toBe('20');
    expect(right).toMatchObject({ fromLane: 1, toLane: 1 });
    expect(right.to.wayId).toBe('40');
    expect(south.filter((l) => l.turn === 'through')).toHaveLength(2);
  });

  test('written rules are read from turn:lanes of the approach', () => {
    const a = fromSouth(cross('<tag k="turn:lanes:forward" v="left|through;right"/>'));
    expect(a.explicit).toBe(true);
    expect(a.turns).toEqual([['left'], ['through', 'right']]);
  });

  test('forbidding a turn writes the rules of the whole approach', () => {
    const doc = toggleLaneTurn(cross(), '0', { wayId: '10', step: -1 }, 0, 'through');
    expect(doc.ways['10'].tags['turn:lanes:forward']).toBe('left|through;right');
    expect(fromSouth(doc).explicit).toBe(true);
  });

  test('adding a lane to an approach changes only that direction and resets its rules', () => {
    const doc = setApproachLanes(cross('<tag k="turn:lanes:forward" v="left|through;right"/>'), '0', { wayId: '10', step: -1 }, 3);
    expect(doc.ways['10'].tags).toMatchObject({ 'lanes:forward': '3', 'lanes:backward': '2', lanes: '5' });
    expect(doc.ways['10'].tags['turn:lanes:forward']).toBeUndefined();
    expect(fromSouth(doc).turns).toHaveLength(3);
  });

  test('an approach keeps at least one lane, and a one-way road changes its lanes', () => {
    expect(setApproachLanes(cross(), '0', { wayId: '10', step: -1 }, 0).ways['10'].tags['lanes:forward']).toBe('1');
    const oneway = setApproachLanes(cross('<tag k="oneway" v="yes"/>'), '0', { wayId: '10', step: -1 }, 3);
    expect(oneway.ways['10'].tags.lanes).toBe('3');
  });

  test('changing the lanes of a road passing through changes only the piece before the junction', () => {
    const doc = setApproachLanes(cross('', true), '0', { wayId: '13', step: -1 }, 3);
    expect(doc.ways['13'].refs).toEqual(['1', '0']);
    expect(doc.ways['13'].tags['lanes:forward']).toBe('3');
    const north = Object.values(doc.ways).find((w) => w.refs[0] === '0' && w.refs[1] === '3')!;
    expect(north.tags.lanes).toBe('4');
  });

  test('a road passing through is split so the rule applies at this junction', () => {
    const doc = toggleLaneTurn(cross('', true), '0', { wayId: '13', step: -1 }, 1, 'right');
    expect(doc.ways['13'].refs).toEqual(['1', '0']);
    expect(doc.ways['13'].tags['turn:lanes:forward']).toBe('left;through|through');
    const north = Object.values(doc.ways).find((w) => w.refs[0] === '0' && w.refs[1] === '3')!;
    expect(north.tags['turn:lanes:forward']).toBeUndefined();
  });

  test('templates write strict rules for every approach and drop them again', () => {
    const strict = applyJunctionTemplate(cross(), '0', 'strict');
    expect(strict.ways['10'].tags['turn:lanes:forward']).toBe('left;through|through;right');
    expect(strict.ways['20'].tags['turn:lanes:forward']).toBe('left;through|through;right');
    const free = applyJunctionTemplate(cross(), '0', 'free');
    expect(free.ways['10'].tags['turn:lanes:forward']).toBe('left;through;right|left;through;right');
    const usual = applyJunctionTemplate(strict, '0', 'usual');
    expect(usual.ways['10'].tags['turn:lanes:forward']).toBeUndefined();
  });
});
