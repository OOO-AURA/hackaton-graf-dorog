import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { parseOsm } from '../osm/parse';
import { useEditor } from '../state/store';
import { useRoute } from '../state/route';
import { RouteSection } from './RouteSection';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const XML = `<osm version="0.6">
  <node id="1" lat="52.0" lon="104.000"/><node id="2" lat="52.0" lon="104.003"/><node id="3" lat="52.0" lon="104.006"/>
  <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="primary"/><tag k="name" v="Лермонтова"/></way>
  <way id="11"><nd ref="2"/><nd ref="3"/><tag k="highway" v="primary"/><tag k="oneway" v="yes"/><tag k="name" v="Лермонтова"/></way>
</osm>`;

describe('route section', () => {
  it('shows the route, then a one-way cut after the user reverses the trip', () => {
    act(() => useEditor.getState().load(parseOsm(XML), 'r.osm'));
    const mount = document.createElement('div');
    document.body.append(mount);
    const root = createRoot(mount);
    act(() => root.render(<RouteSection nodeId="1" />));
    act(() => useRoute.getState().setFrom('1'));
    act(() => useRoute.getState().setTo('3'));
    expect(mount.textContent).toContain('км');
    expect(mount.textContent).toContain('Лермонтова');
    act(() => useRoute.getState().setFrom('3'));
    act(() => useRoute.getState().setTo('1'));
    expect(mount.textContent).toContain('Проехать нельзя');
    act(() => useEditor.getState().load(parseOsm('<osm version="0.6"/>'), 'empty.osm'));
    expect(useRoute.getState().result).toBeNull();
    act(() => root.unmount());
  });
});
