import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { parseOsm } from '../osm/parse';
import { junctionLanes } from '../osm/lanes';
import { useEditor } from '../state/store';
import { JunctionCard } from './JunctionCard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A crossroads at node 0 of four two-way roads with four lanes. */
const XML = `<osm version="0.6">
  <node id="0" lat="52.0000" lon="104.0000"/><node id="1" lat="51.9990" lon="104.0000"/>
  <node id="2" lat="52.0000" lon="103.9985"/><node id="3" lat="52.0010" lon="104.0000"/><node id="4" lat="52.0000" lon="104.0015"/>
  <way id="10"><nd ref="1"/><nd ref="0"/><tag k="highway" v="primary"/><tag k="lanes" v="4"/><tag k="name" v="Лермонтова"/></way>
  <way id="20"><nd ref="2"/><nd ref="0"/><tag k="highway" v="primary"/><tag k="lanes" v="4"/><tag k="name" v="Игошина"/></way>
  <way id="30"><nd ref="3"/><nd ref="0"/><tag k="highway" v="primary"/><tag k="lanes" v="4"/><tag k="name" v="Лермонтова"/></way>
  <way id="40"><nd ref="4"/><nd ref="0"/><tag k="highway" v="primary"/><tag k="lanes" v="4"/><tag k="name" v="Игошина"/></way>
</osm>`;

function render(node: React.ReactNode) {
  const mount = document.createElement('div');
  document.body.append(mount);
  const root = createRoot(mount);
  act(() => root.render(node));
  return { mount, done: () => act(() => root.unmount()) };
}

const south = () => junctionLanes(useEditor.getState().doc, '0').approaches.find((a) => a.arm.wayId === '10')!;

describe('junction card', () => {
  beforeEach(() => act(() => {
    useEditor.getState().load(parseOsm(XML), 'cross.osm');
    useEditor.getState().select({ type: 'node', id: '0' });
  }));

  test('shows every approach with its lanes, named after the streets', () => {
    const r = render(<JunctionCard />);
    expect(r.mount.textContent).toContain('Лермонтова × Игошина');
    expect(r.mount.querySelectorAll('.jc-approach')).toHaveLength(4);
    expect(r.mount.querySelectorAll('.jc-approach')[0].querySelectorAll('.jc-lane')).toHaveLength(2);
    // Four approaches of two lanes, no signs: the right-hand rule, 650 an hour a lane.
    expect(r.mount.textContent).toContain('Пропускная способность');
    expect(r.mount.textContent).toMatch(/5\s?200 авт\/ч/);
    r.done();
  });

  test('+ adds a lane to the approach, a turn button forbids that turn', () => {
    const r = render(<JunctionCard />);
    const row = () => [...r.mount.querySelectorAll('.jc-approach')].find((el) => el.textContent?.includes('Лермонтова') && el.querySelector('.jc-street em')?.textContent === 'Ю')!;
    act(() => (row().querySelector('.jc-stepper button:last-child') as HTMLButtonElement).click());
    expect(south().turns).toHaveLength(3);
    const firstOn = row().querySelector('.jc-lane .jc-turn.on') as HTMLButtonElement;
    act(() => firstOn.click());
    expect(south().turns[0]).toHaveLength(1);
    r.done();
  });

  test('is not shown for a node that is not a junction', () => {
    act(() => useEditor.getState().select({ type: 'node', id: '1' }));
    const r = render(<JunctionCard />);
    expect(r.mount.querySelector('.junction-card')).toBeNull();
    r.done();
  });
});
