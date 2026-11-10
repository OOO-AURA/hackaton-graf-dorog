import { parseOsm } from './parse';
import { armsAt } from './lanes';
import { approachControl, placeRuleSigns, signPoints } from './signs';

/**
 * A T-junction at node 0: a secondary road runs west (1) to east (2), a residential street comes
 * in from the south (3). Node 4 is on the side street 20 m before the junction.
 */
const tee = (sideTags = '', node4 = '', mainClass = 'secondary') => parseOsm(`<osm version="0.6">
  <node id="0" lat="52.0000" lon="104.0000"/><node id="1" lat="52.0000" lon="103.9980"/><node id="2" lat="52.0000" lon="104.0020"/>
  <node id="3" lat="51.9985" lon="104.0000"/><node id="4" lat="51.99982" lon="104.0000">${node4}</node>
  <way id="10"><nd ref="1"/><nd ref="0"/><nd ref="2"/><tag k="highway" v="${mainClass}"/><tag k="lanes" v="2"/></way>
  <way id="20"><nd ref="3"/><nd ref="4"/><nd ref="0"/><tag k="highway" v="residential"/>${sideTags}</way>
</osm>`);

const sideArm = (doc: ReturnType<typeof tee>) => armsAt(doc, '0').find((a) => a.wayId === '20')!;

describe('road signs by the traffic rules', () => {
  test('the side street of a T-junction gives way, the main road is marked as the main road', () => {
    const { doc, giveWay, mainRoads } = placeRuleSigns(tee());
    expect(giveWay).toBe(1);
    expect(mainRoads).toBe(1);
    expect(doc.ways['10'].tags.priority_road).toBe('designated');
    const sign = Object.values(doc.nodes).find((n) => n.tags.highway === 'give_way')!;
    expect(sign).toBeDefined();
    expect(doc.ways['20'].refs).toContain(sign.id);
    // Traffic on way 20 runs towards the junction, along the way.
    expect(sign.tags.direction).toBe('forward');
    expect(approachControl(doc, '0', sideArm(doc))).toBe('give_way');
  });

  test('roads of one class give no signs: the right-hand rule applies', () => {
    const { giveWay, mainRoads } = placeRuleSigns(tee('', '', 'residential'));
    expect(giveWay).toBe(0);
    expect(mainRoads).toBe(0);
  });

  test('a yard driveway onto a street gets no sign: who leaves it gives way anyway', () => {
    const doc = parseOsm(`<osm version="0.6">
      <node id="0" lat="52.0000" lon="104.0000"/><node id="1" lat="52.0000" lon="103.9980"/><node id="2" lat="52.0000" lon="104.0020"/><node id="3" lat="51.9985" lon="104.0000"/>
      <way id="10"><nd ref="1"/><nd ref="0"/><nd ref="2"/><tag k="highway" v="residential"/></way>
      <way id="20"><nd ref="3"/><nd ref="0"/><tag k="highway" v="service"/></way></osm>`);
    expect(placeRuleSigns(doc)).toMatchObject({ giveWay: 0, mainRoads: 0 });
  });

  test('a junction with a traffic light gets no signs, and its approaches are signal controlled', () => {
    const doc = tee('', '<tag k="highway" v="traffic_signals"/>');
    expect(approachControl(doc, '0', sideArm(doc))).toBe('signal');
    expect(placeRuleSigns(doc).giveWay).toBe(0);
  });

  test('a stop sign on the approach makes it a stop approach, and placing again adds nothing', () => {
    const doc = tee('', '<tag k="highway" v="stop"/>');
    expect(approachControl(doc, '0', sideArm(doc))).toBe('stop');
    expect(placeRuleSigns(doc).giveWay).toBe(0);
    const once = placeRuleSigns(tee()).doc;
    expect(placeRuleSigns(once).giveWay).toBe(0);
  });

  test('signs stand on the right of the road, facing the traffic they are for', () => {
    const { doc } = placeRuleSigns(tee());
    const points = signPoints(doc).features;
    const giveWay = points.find((f) => f.properties.sign === 'give_way')!;
    // Traffic on the side street drives north, so the sign is to the east of the street.
    expect(giveWay.geometry.coordinates[0]).toBeGreaterThan(104.0);
    expect(points.filter((f) => f.properties.sign === 'main_road').length).toBeGreaterThanOrEqual(2);
  });
});
