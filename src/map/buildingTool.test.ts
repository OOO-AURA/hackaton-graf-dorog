import { parseOsm } from '../osm/parse';
import { orientedBox } from '../osm/buildingShape';
import { metres } from '../osm/buildingEdit';
import { ghostAt } from './buildingTool';

/** A two-lane road running east along latitude 52. */
const doc = parseOsm(`<osm version="0.6">
  <node id="1" lat="52.0" lon="104.000"/><node id="2" lat="52.0" lon="104.004"/>
  <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/></way></osm>`);

describe('building ghost', () => {
  const m = metres(52);
  const local = (g: ReturnType<typeof ghostAt>) => g.ring.map(m.to);

  test('near a road it lines up with it and stands back from the carriageway', () => {
    const cursor = m.back([m.to([104.002, 52])[0], m.to([104.002, 52])[1] + 5]);
    const g = ghostAt(doc, cursor, 1, 0, false);
    expect(g.aligned).toBe(true);
    expect(g.onRoad).toBe(false);
    const box = orientedBox(local(g));
    expect(box.angle).toBeCloseTo(90, 0);
    // Road half width 3.5 m, 4 m gap, then half the 20 m depth: the middle is 17.5 m north of the road.
    expect(box.center[1] - m.to([104.002, 52])[1]).toBeCloseTo(17.5, 1);
  });

  test('R turns it, Alt leaves it where the cursor is, across the road it warns', () => {
    const cursor: [number, number] = [104.002, 52];
    expect(orientedBox(local(ghostAt(doc, cursor, 1, 90, false))).angle).toBeCloseTo(0, 0);
    const free = ghostAt(doc, cursor, 1, 0, true);
    expect(free.aligned).toBe(false);
    expect(free.onRoad).toBe(true);
  });
});
