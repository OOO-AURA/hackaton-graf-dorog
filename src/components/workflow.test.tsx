import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { parseOsm } from '../osm/parse';
import { useEditor } from '../state/store';
import { useUi } from '../state/ui';
import { StepBar } from './StepBar';
import { SaveMenu } from './SaveMenu';
import { MapHint } from './MapHint';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const XML = '<osm version="0.6"><node id="1" lat="52.26" lon="104.26"/><node id="2" lat="52.27" lon="104.27"/><way id="5"><nd ref="1"/><nd ref="2"/><tag k="highway" v="primary"/></way></osm>';

function render(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return { host, done: () => { act(() => root.unmount()); host.remove(); } };
}

describe('the work in steps', () => {
  beforeEach(() => {
    useEditor.getState().load(parseOsm(XML), 'a.osm');
    useUi.getState().setStep('edit');
    useUi.getState().setMapHints(true);
  });

  test('the header lists the three steps unnumbered and a click moves to one', () => {
    const r = render(<StepBar />);
    const buttons = [...r.host.querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Редактирование', 'Макро', 'Микро']);
    act(() => buttons[1].click());
    expect(useUi.getState()).toMatchObject({ step: 'flows', bottomTab: 'flows', bottomOpen: true });
    expect(buttons[1].getAttribute('aria-current')).toBe('step');
    r.done();
  });

  test('the save menu holds the team file name and the exports', () => {
    useEditor.getState().setSaveName('graph.osm');
    const r = render(<SaveMenu />);
    expect(r.host.textContent).toContain('сервер ждёт hack-teamNN.osm');
    expect(r.host.textContent).toContain('Сеть MATSim network.xml');
    act(() => useEditor.getState().setSaveName('hack-team10.osm'));
    expect(r.host.textContent).not.toContain('сервер ждёт');
    r.done();
  });

  test('the map hint follows the tool and goes away when turned off', () => {
    const r = render(<MapHint />);
    expect(r.host.textContent).toContain('Кликните дорогу, перекрёсток или здание');
    act(() => useEditor.getState().setMode('draw'));
    expect(r.host.textContent).toContain('откуда начинается дорога');
    act(() => (r.host.querySelector('button') as HTMLButtonElement).click());
    expect(r.host.textContent).toBe('');
    expect(useUi.getState().mapHints).toBe(false);
    act(() => useEditor.getState().setMode('select'));
    r.done();
  });
});
