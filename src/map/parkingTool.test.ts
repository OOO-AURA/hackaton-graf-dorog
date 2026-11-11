import { parseOsm } from '../osm/parse';
import { orientedBox } from '../osm/buildingShape';
import { metres } from '../osm/buildingEdit';
import { isParkingArea, PARKING_TEMPLATES } from '../osm/parking';
import { useEditor } from '../state/store';
import { parkingGhostAt, placeParkingGhost, useParkingTool } from './parkingTool';
import { parkingGeoJson } from './geojson';
import { canPickWay, TOOLS_IN, wayKind } from './editScope';

/** A two-lane road running east along latitude 52. */
const ROAD = `<osm version="0.6">
  <node id="1" lat="52.0" lon="104.000"/><node id="2" lat="52.0" lon="104.004"/>
  <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/></way></osm>`;

describe('car park tool', () => {
  beforeEach(() => {
    useEditor.getState().load(parseOsm(ROAD), 'road.osm');
    useParkingTool.setState({ template: 1, turn: 0, free: false, ghost: null });
  });

  test('the ghost has the size of the template and lines up with the road beside it', () => {
    const g = parkingGhostAt([104.002, 52.0003]);
    expect(g.aligned).toBe(true);
    const box = orientedBox(g.ring.map(metres(52).to));
    expect(box.width).toBeCloseTo(PARKING_TEMPLATES[1].width, 0);
    expect(box.length).toBeCloseTo(PARKING_TEMPLATES[1].length, 0);
    expect(g.onRoad).toBe(false);
  });

  test('a click puts a car park with one undo step, and nothing without a ghost', () => {
    expect(placeParkingGhost()).toBe('');
    useParkingTool.getState().setGhost(parkingGhostAt([104.002, 52.0003]));
    const id = placeParkingGhost();
    const s = useEditor.getState();
    expect(isParkingArea(s.doc.ways[id])).toBe(true);
    expect(s.past).toHaveLength(1);
    s.undo();
    expect(useEditor.getState().doc.ways[id]).toBeUndefined();
  });

  test('the template index stays within the templates', () => {
    useParkingTool.getState().setTemplate(99);
    expect(useParkingTool.getState().template).toBe(PARKING_TEMPLATES.length - 1);
  });

  test('the map gets the area and a P sign in its middle; a point car park gets the sign alone', () => {
    useParkingTool.getState().setGhost(parkingGhostAt([104.002, 52.0003]));
    const id = placeParkingGhost();
    const doc = { ...useEditor.getState().doc };
    doc.nodes = { ...doc.nodes, 900: { id: '900', lat: 52.001, lon: 104.001, tags: { amenity: 'parking' }, attrs: {} } };
    const kinds = parkingGeoJson(doc).features.map((f) => `${f.properties.kind}:${f.properties.id}`);
    expect(kinds).toEqual(expect.arrayContaining([`area:${id}`, `sign:${id}`, 'sign:900']));
  });

  test('a car park is picked in the general and the car views, and the tool is offered there', () => {
    useParkingTool.getState().setGhost(parkingGhostAt([104.002, 52.0003]));
    const id = placeParkingGhost();
    const doc = useEditor.getState().doc;
    expect(wayKind(doc.ways[id])).toBe('parking');
    expect(canPickWay(doc, 'all', id)).toBe(true);
    expect(canPickWay(doc, 'car', id)).toBe(true);
    expect(canPickWay(doc, 'walk', id)).toBe(false);
    expect(TOOLS_IN.all.has('parking') && TOOLS_IN.car.has('parking')).toBe(true);
  });
});
