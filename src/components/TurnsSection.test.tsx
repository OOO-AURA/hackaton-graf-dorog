import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { parseOsm } from '../osm/parse';
import { restrictionsAt } from '../osm/turns';
import { useEditor } from '../state/store';
import { NodeInspector } from './NodeInspector';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const XML = `<osm version="0.6">
  <node id="1" lat="52.0000" lon="104.0000"/><node id="2" lat="52.0000" lon="104.0030"/><node id="3" lat="52.0000" lon="104.0060"/>
  <node id="4" lat="51.9980" lon="104.0030"/><node id="5" lat="52.0020" lon="104.0030"/>
  <way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><tag k="highway" v="primary"/><tag k="name" v="Лермонтова"/></way>
  <way id="12"><nd ref="4"/><nd ref="2"/><tag k="highway" v="secondary"/><tag k="name" v="Игошина"/></way>
  <way id="13"><nd ref="2"/><nd ref="5"/><tag k="highway" v="secondary"/><tag k="name" v="Игошина"/></way>
</osm>`;

describe('turns table in the node inspector', () => {
  it('lists the movements of a junction and forbids one with a click, undoable in one step', () => {
    act(() => useEditor.getState().load(parseOsm(XML), 'cross.osm'));
    const mount = document.createElement('div');
    document.body.append(mount);
    const root = createRoot(mount);
    const render = () => act(() => root.render(<NodeInspector node={useEditor.getState().doc.nodes['2']} />));
    render();
    expect(mount.textContent).toContain('Повороты');
    expect(mount.textContent).toContain('Въезд: Лермонтова, З');
    const boxes = () => [...mount.querySelectorAll<HTMLInputElement>('.turn-list input')];
    expect(boxes()).toHaveLength(16);
    expect(boxes().every((b) => b.checked)).toBe(true);

    const leftFromWest = [...mount.querySelectorAll('.turn-group')].find((g) => g.textContent?.includes('Въезд: Лермонтова, З'))!
      .querySelectorAll('li')[3].querySelector('input')!;
    expect(leftFromWest.closest('li')!.textContent).toContain('налево');
    act(() => leftFromWest.click());
    render();
    expect(restrictionsAt(useEditor.getState().doc, '2').map((r) => r.tags.restriction)).toEqual(['no_left_turn']);
    expect(mount.querySelectorAll('.turn-list li.banned')).toHaveLength(1);

    act(() => useEditor.getState().undo());
    render();
    expect(restrictionsAt(useEditor.getState().doc, '2')).toHaveLength(0);
    act(() => root.unmount());
  });
});
