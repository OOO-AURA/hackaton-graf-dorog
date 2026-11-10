import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { parseOsm } from '../osm/parse';
import { validate } from '../osm/validate';
import { useEditor } from '../state/store';
import { IssuesPanel } from './IssuesPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const XML = `<osm version="0.6">
  <node id="1" lat="52.0" lon="104.000"/><node id="2" lat="52.0" lon="104.003"/><node id="3" lat="52.0" lon="104.006"/>
  <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="secondary"/><tag k="name" v="Лермонтова"/></way>
  <way id="11"><nd ref="2"/><nd ref="3"/><tag k="highway" v="primary"/><tag k="maxspeed" v="RU:urban"/></way>
</osm>`;

describe('speed group in the issues panel', () => {
  it('lists roads the simulators read differently and fixes all of them in one step', () => {
    act(() => useEditor.getState().load(parseOsm(XML), 's.osm'));
    act(() => useEditor.setState({ report: validate(useEditor.getState().doc) }));
    const mount = document.createElement('div');
    document.body.append(mount);
    const root = createRoot(mount);
    act(() => root.render(<IssuesPanel />));
    expect(mount.textContent).toContain('Разная скорость в MATSim и SUMO');
    expect(mount.textContent).toContain('Лермонтова: MATSim 30, SUMO 100 км/ч, по ПДД 60');
    const button = [...mount.querySelectorAll('button')].find((b) => b.textContent === 'Проставить по ПДД всем')!;
    act(() => button.click());
    const doc = useEditor.getState().doc;
    expect(doc.ways['10'].tags).toMatchObject({ maxspeed: '60', 'source:maxspeed': 'RU:urban' });
    expect(doc.ways['11'].tags.maxspeed).toBe('60');
    expect(useEditor.getState().past).toHaveLength(1);
    act(() => root.unmount());
  });
});
