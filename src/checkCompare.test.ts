import { compareStage } from './checkCompare';
import type { CheckReport } from './check';

const report = (links: string, kept: string): CheckReport => ({
  work_dir: '/tmp', stages: [{ name: 'MATSim', status: 'ok', seconds: 2, metrics: [['Линков', links], ['В сильно связной части', kept], ['Версия', 'MATSim 2026.0']], problems: [], log_tail: '' }],
});

describe('compareStage', () => {
  test('puts the opened file next to the current graph with numeric deltas', () => {
    const rows = compareStage(report('169', '165 (97,6%)'), report('163', '140 (85,9%)'), 'MATSim');
    expect(rows).toEqual([
      { key: 'Линков', before: '163', after: '169', delta: 6 },
      { key: 'В сильно связной части', before: '140 (85,9%)', after: '165 (97,6%)', delta: 25 },
      { key: 'Версия', before: 'MATSim 2026.0', after: 'MATSim 2026.0', delta: null },
    ]);
  });

  test('without a baseline only the current values are shown', () => {
    expect(compareStage(report('169', '165'), null, 'MATSim')[0]).toEqual({ key: 'Линков', before: null, after: '169', delta: null });
    expect(compareStage(report('1', '1'), null, 'SUMO')).toEqual([]);
  });
});
