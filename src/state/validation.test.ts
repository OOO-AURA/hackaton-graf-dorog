import { describe, expect, it } from 'vitest';
import { EMPTY_DOC } from '../osm/types';
import { refreshReport } from './validation';
import { useEditor } from './store';

describe('background validation', () => {
  it('falls back to the main thread without workers and stores the report', async () => {
    useEditor.getState().load(EMPTY_DOC, 'empty.osm');
    const report = await refreshReport();
    expect(report.issues).toEqual([]);
    expect(useEditor.getState().report).toBe(report);
  });
});
