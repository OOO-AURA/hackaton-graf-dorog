import type { Issue } from '../osm/validate';
import { logText, useErrorLog } from './errorLog';

const issue = (id: string, severity: Issue['severity'] = 'error'): Issue =>
  ({ id, kind: 'head-on', severity, message: `ошибка ${id}`, at: [104, 52], wayIds: [], nodeIds: [] });

describe('error log', () => {
  beforeEach(() => useErrorLog.getState().clear());

  test('a graph error is logged when it appears and marked fixed when it goes', () => {
    const log = useErrorLog.getState();
    log.syncIssues([issue('a'), issue('w', 'warning')]);
    expect(useErrorLog.getState().entries.map((e) => e.issueId)).toEqual(['a']);
    log.syncIssues([issue('a')]);
    expect(useErrorLog.getState().entries).toHaveLength(1);
    log.syncIssues([issue('b')]);
    const [a, b] = useErrorLog.getState().entries;
    expect(a.fixedAt).toBeDefined();
    expect(b.issueId).toBe('b');
    expect(b.fixedAt).toBeUndefined();
  });

  test('application failures go in as they come, and the log reads as text', () => {
    useErrorLog.getState().add('app', 'Не удалось загрузить область');
    const txt = logText(useErrorLog.getState().entries);
    expect(txt).toContain('приложение');
    expect(txt).toContain('Не удалось загрузить область');
  });
});
