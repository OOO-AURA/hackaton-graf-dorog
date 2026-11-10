import { parseOsm } from '../osm/parse';
import { useEditor } from './store';
import { finishDrawing } from './actions';

const M_LON = 1 / (111_320 * Math.cos((52 * Math.PI) / 180));
const M_LAT = 1 / 111_320;
/** A 40 × 40 m building at the origin; the road is drawn north to south through its middle. */
const XML = `<osm version="0.6">
  ${[[0, 0], [40, 0], [40, 40], [0, 40]].map(([x, y], i) => `<node id="${i + 1}" lat="${52 + y * M_LAT}" lon="${104 + x * M_LON}"/>`).join('')}
  <way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><nd ref="1"/><tag k="building" v="yes"/></way>
</osm>`;
const ROAD = [{ lon: 104 + 20 * M_LON, lat: 52 + 60 * M_LAT }, { lon: 104 + 20 * M_LON, lat: 52 - 20 * M_LAT }];

const roads = () => Object.values(useEditor.getState().doc.ways).filter((w) => w.tags.highway);
const buildings = () => Object.values(useEditor.getState().doc.ways).filter((w) => w.tags.building);

describe('drawing a road through a building', () => {
  beforeEach(() => {
    const s = useEditor.getState();
    s.load(parseOsm(XML), 'b.osm');
    s.setMode('draw');
    s.setTemplate(2);
    useEditor.getState().setDrawing(ROAD);
  });

  test('Enter does not build over a building and says what can be done', () => {
    finishDrawing();
    expect(roads()).toHaveLength(0);
    expect(useEditor.getState().drawing).toHaveLength(2);
    expect(useEditor.getState().message).toContain('срезать');
  });

  test('cutting builds the road and leaves the building in two parts, in one undo step', () => {
    finishDrawing('cut');
    expect(roads()).toHaveLength(1);
    expect(buildings()).toHaveLength(2);
    useEditor.getState().undo();
    expect(roads()).toHaveLength(0);
    expect(buildings().map((w) => w.id)).toEqual(['10']);
  });

  test('demolishing builds the road and removes the building; building over keeps it', () => {
    finishDrawing('demolish');
    expect(roads()).toHaveLength(1);
    expect(buildings()).toHaveLength(0);
    useEditor.getState().undo();
    useEditor.getState().setDrawing(ROAD);
    finishDrawing('keep');
    expect(roads()).toHaveLength(1);
    expect(buildings()).toHaveLength(1);
  });
});
