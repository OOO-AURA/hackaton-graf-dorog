import { describe, expect, it } from 'vitest';
import { useSim } from './store';

describe('sim store', () => {
  it('gives OD demand at least 15 minutes so trips have time to finish', () => {
    useSim.setState({ minutes: 10, demand: 'random' });
    useSim.getState().setDemand('od');
    expect(useSim.getState().minutes).toBe(15);
    useSim.getState().setMinutes(20);
    useSim.getState().setDemand('random');
    useSim.getState().setDemand('od');
    expect(useSim.getState().minutes).toBe(20);
  });
});
