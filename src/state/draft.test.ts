import { beforeEach, describe, expect, it } from 'vitest';
import { parseOsm } from '../osm/parse';
import { EMPTY_DOC } from '../osm/types';
import { autosaveTick, restoreDraft, useDraft, type Draft, type DraftStore } from './draft';
import { isDirty, useEditor } from './store';

function memory(): DraftStore & { value: Draft | null; writes: number } {
  const m = {
    value: null as Draft | null, writes: 0,
    read: async () => m.value,
    write: async (d: Draft) => { m.value = d; m.writes += 1; },
    clear: async () => { m.value = null; },
  };
  return m;
}

const XML = '<osm version="0.6"><node id="1" lat="52.26" lon="104.26"/><node id="2" lat="52.27" lon="104.27"/><way id="5"><nd ref="1"/><nd ref="2"/><tag k="highway" v="primary"/></way></osm>';

describe('draft autosave', () => {
  beforeEach(() => useEditor.getState().load(parseOsm(XML), 'a.osm', '/tmp/a.osm'));

  it('writes only when there are unsaved edits, once per document, and clears after saving', async () => {
    const s = memory();
    await autosaveTick(s);
    expect(s.value).toBeNull();
    useEditor.getState().apply((d) => ({ ...d, ways: { ...d.ways, 5: { ...d.ways[5], tags: { highway: 'primary', lanes: '4' } } } }));
    await autosaveTick(s);
    await autosaveTick(s);
    expect(s.writes).toBe(1);
    expect(s.value?.xml).toContain('lanes');
    expect(s.value?.filePath).toBe('/tmp/a.osm');
    useEditor.setState({ savedDoc: useEditor.getState().doc });
    await autosaveTick(s);
    expect(s.value).toBeNull();
  });

  it('restores a draft as unsaved edits of the same file', async () => {
    useEditor.getState().load(EMPTY_DOC, '');
    useDraft.setState({ found: { xml: XML.replace('primary', 'secondary'), fileName: 'a.osm', filePath: '/tmp/a.osm', savedAt: 0, ways: 1 } });
    await restoreDraft();
    const st = useEditor.getState();
    expect(st.doc.ways['5'].tags.highway).toBe('secondary');
    expect(st.filePath).toBe('/tmp/a.osm');
    expect(isDirty(st)).toBe(true);
    expect(useDraft.getState().found).toBeNull();
  });
});
