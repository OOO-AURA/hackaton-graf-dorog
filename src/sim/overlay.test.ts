import { describe, expect, it } from 'vitest';
import { SIGNAL_COLORS, signalFeatures, stateAt } from './overlay';
import type { SimResult } from './types';

const sig = { id: 'j1', lon: 0, lat: 0, heads: [[0, 1, 1], [2, 2, 2]] as Array<[number, number, number]>, states: [[0, 'GGrr'], [30, 'yyrr'], [34, 'rrGG']] as Array<[number, string]> };

describe('signal overlay', () => {
  it('takes the last state at or before t', () => {
    expect(stateAt(sig, 0)).toBe('GGrr');
    expect(stateAt(sig, 31)).toBe('yyrr');
    expect(stateAt(sig, 100)).toBe('rrGG');
  });
  it('colours each head by its link', () => {
    const r = { signals: [sig] } as unknown as SimResult;
    const colors = (t: number) => signalFeatures(r, t).map((f) => (f as { properties: { color: string } }).properties.color);
    expect(colors(5)).toEqual([SIGNAL_COLORS.green, SIGNAL_COLORS.red]);
    expect(colors(40)).toEqual([SIGNAL_COLORS.red, SIGNAL_COLORS.green]);
  });
});
