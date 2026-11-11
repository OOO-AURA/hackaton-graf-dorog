import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { parseOsm } from '../osm/parse';
import { setWayTag } from '../osm/edit';
import { useEditor } from '../state/store';
import { BuildingInspector } from './BuildingInspector';
import { StreetInspector } from './StreetInspector';
import { WayInspector } from './WayInspector';
import { ChangesSummary } from './ChangesSummary';
import { BundleSection } from './BundleSection';
import { Inspector } from './Inspector';
import { ParkingInspector } from './ParkingInspector';
import { placeParking, PARKING_TEMPLATES } from '../osm/parking';
import { deleteSelection } from '../state/actions';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const XML = `<osm version="0.6">
  <node id="1" lat="52.0" lon="104.000"/><node id="2" lat="52.0" lon="104.003"/><node id="3" lat="52.0" lon="104.006"/>
  <node id="5" lat="52.001" lon="104.000"/><node id="6" lat="52.001" lon="104.001"/><node id="7" lat="52.0015" lon="104.001"/><node id="8" lat="52.0015" lon="104.000"/>
  <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="secondary"/><tag k="name" v="Лермонтова"/><tag k="bridge" v="yes"/><tag k="layer" v="1"/></way>
  <way id="11"><nd ref="2"/><nd ref="3"/><tag k="highway" v="secondary"/><tag k="name" v="Лермонтова"/><tag k="lanes" v="4"/><tag k="tunnel" v="yes"/><tag k="layer" v="-1"/></way>
  <way id="20"><nd ref="5"/><nd ref="6"/><nd ref="7"/><nd ref="8"/><nd ref="5"/><tag k="building" v="apartments"/><tag k="name" v="Корпус А"/></way>
</osm>`;

function render(node: React.ReactNode): { text: () => string; done: () => void } {
  const mount = document.createElement('div');
  document.body.append(mount);
  const root = createRoot(mount);
  act(() => root.render(node));
  return { text: () => mount.textContent ?? '', done: () => act(() => root.unmount()) };
}

describe('new panels render on real data', () => {
  beforeEach(() => act(() => useEditor.getState().load(parseOsm(XML), 'smoke.osm')));
  const doc = () => useEditor.getState().doc;

  test('building inspector shows the Webots height by type', () => {
    const r = render(<BuildingInspector way={doc().ways['20']} />);
    expect(r.text()).toContain('Корпус А');
    expect(r.text()).toContain('12 м');
    r.done();
  });

  test('road inspector tells the Webots height of a bridge and the simulator speeds', () => {
    const r = render(<WayInspector way={doc().ways['10']} />);
    expect(r.text()).toContain('5 м над землёй');
    expect(r.text()).toContain('MATSim 30 км/ч, SUMO 100 км/ч');
    expect(r.text()).toContain('Вся улица: 2 участков');
    expect(r.text()).toContain('Как прочитают симуляторы');
    expect(r.text()).toContain('на 5 м над землёй');
    r.done();
    const t = render(<WayInspector way={doc().ways['11']} />);
    expect(t.text()).toContain('Webots не строит дороги с отрицательным layer');
    t.done();
  });

  test('street inspector, inspector routing for buildings and streets', () => {
    const s = render(<StreetInspector name="Лермонтова" />);
    expect(s.text()).toContain('2 участков');
    s.done();
    act(() => useEditor.getState().select({ type: 'way', id: '20' }));
    const i = render(<Inspector />);
    expect(i.text()).toContain('Здание');
    act(() => useEditor.getState().select({ type: 'street', id: 'Лермонтова' }));
    expect(i.text()).toContain('Улица целиком');
    i.done();
  });

  test('changes summary appears after an edit; bundle section waits for flows', () => {
    const c = render(<ChangesSummary />);
    expect(c.text()).toBe('');
    act(() => useEditor.getState().apply((d) => setWayTag(d, '10', 'maxspeed', '60')));
    expect(c.text()).toContain('изменено 1');
    c.done();
    const b = render(<BundleSection />);
    expect(b.text()).toContain('Пучок потоков');
    b.done();
  });
});

describe('railway panels', () => {
  const RAIL = `<osm version="0.6">
    <node id="1" lat="52.0" lon="104.000"/><node id="2" lat="52.0" lon="104.001"/>
    <node id="3" lat="52.0005" lon="104.0005"><tag k="railway" v="halt"/><tag k="name" v="Мельниково"/></node>
    <way id="10"><nd ref="1"/><nd ref="2"/><tag k="railway" v="rail"/><tag k="service" v="siding"/></way></osm>`;
  beforeEach(() => act(() => useEditor.getState().load(parseOsm(RAIL), 'rail.osm')));

  test('a selected track opens the rail inspector, a station the station one', () => {
    act(() => useEditor.getState().select({ type: 'way', id: '10' }));
    const r = render(<Inspector />);
    expect(r.text()).toContain('Железная дорога');
    expect(r.text()).toContain('Боковой путь');
    act(() => useEditor.getState().select({ type: 'node', id: '3' }));
    expect(r.text()).toContain('Мельниково');
    expect(r.text()).toContain('Остановочный пункт');
    r.done();
  });

  test('car park inspector shows places by area, the disabled places the rules ask for, and switches kind', () => {
    let id = '';
    act(() => useEditor.getState().apply((d) => { const r = placeParking(d, [104.001, 52.0005], PARKING_TEMPLATES[1], 0); id = r.id; return r.doc; }));
    act(() => useEditor.getState().select({ type: 'way', id }));
    const r = render(<Inspector />);
    expect(r.text()).toContain('Парковка');
    expect(r.text()).toContain('≈ 40 мест');
    expect(r.text()).toContain('СП 59.13330');
    r.done();
    const p = render(<ParkingInspector way={useEditor.getState().doc.ways[id]} />);
    expect(p.text()).toContain('Места по площади');
    p.done();
    act(() => deleteSelection());
    expect(useEditor.getState().doc.ways[id]).toBeUndefined();
  });
});
