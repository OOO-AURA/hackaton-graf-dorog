import { describe, expect, it } from 'vitest';
import { homeShare, meanTime, purposeMatrices, solveBeta, timeHistogram } from './purposes';

const times = [[0, 4, 10], [4, 0, 6], [10, 6, 0]];
const zones = [{ weight: 10, home: 9, work: 1 }, { weight: 10, home: 5, work: 5 }, { weight: 10, home: 1, work: 9 }];

describe('trip purposes and β', () => {
  it('splits trips by purpose and keeps the total', () => {
    const { mats, od } = purposeMatrices(times, zones, 1000, 0.1);
    expect(mats).toHaveLength(2);
    const total = od.flat().reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(1000, 6);
    expect(homeShare('apartments')).toBe(1);
    expect(homeShare('office')).toBe(0);
  });

  it('a larger β gives shorter trips and calibration hits the target', () => {
    const at = (b: number) => meanTime(purposeMatrices(times, zones, 1000, b).od, times);
    expect(at(0.5)).toBeLessThan(at(0.05));
    const b = solveBeta(at, 6);
    expect(b).not.toBeNull();
    expect(at(b!)).toBeCloseTo(6, 2);
    expect(solveBeta(at, 30)).toBeNull();
  });

  it('builds a trip time histogram that sums to one', () => {
    const h = timeHistogram(purposeMatrices(times, zones, 1000, 0.1).od, times, 2);
    expect(h.reduce((s, b) => s + b.share, 0)).toBeCloseTo(1, 6);
  });
});
