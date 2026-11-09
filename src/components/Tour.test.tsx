import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { parseOsm } from '../osm/parse';
import { useEditor } from '../state/store';
import { useUi } from '../state/ui';
import { Tour, useTour } from './Tour';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const XML = '<osm version="0.6"><node id="1" lat="52.26" lon="104.26"/><node id="2" lat="52.27" lon="104.27"/><way id="5"><nd ref="1"/><nd ref="2"/><tag k="highway" v="primary"/></way></osm>';

describe('first-run tour', () => {
  it('moves on as the user edits and opens Micro, then remembers it is done', () => {
    localStorage.removeItem('graf-tour');
    useTour.getState().go(0);
    const host = document.createElement('div');
    host.innerHTML = '<aside data-tour="inspector"></aside>';
    document.body.append(host);
    const mount = document.createElement('div');
    document.body.append(mount);
    const root = createRoot(mount);
    act(() => root.render(<Tour />));
    act(() => useEditor.getState().load(parseOsm(XML), 'a.osm'));
    expect(document.body.textContent).toContain('Шаг 1 из 3');
    act(() => useEditor.getState().apply((d) => ({ ...d, ways: { ...d.ways, 5: { ...d.ways[5], tags: { highway: 'secondary' } } } })));
    expect(useTour.getState().step).toBe(1);
    act(() => useTour.getState().go(2));
    act(() => useUi.getState().setWorkspace('micro'));
    expect(useTour.getState().step).toBeNull();
    expect(localStorage.getItem('graf-tour')).toBe('done');
    act(() => root.unmount());
    host.remove();
    mount.remove();
  });
});
