import { describe, expect, it } from 'vitest';
import type { OsmDoc } from '../osm/types';
import { useEditor } from '../state/store';
import { useSim } from '../sim/store';
import type { SimResult } from '../sim/types';
import { defaultName, useScenarios } from './store';

const doc = (tag: string) => ({ nodes: {}, ways: { w: { id: 'w', refs: [], tags: { highway: tag } } } }) as unknown as OsmDoc;
const sim = (delay: number) => ({ trips: 10, finished: 8, mean_time_loss_s: delay, mean_speed_kmh: 30, mean_waiting_s: 5 }) as SimResult;

describe('scenarios', () => {
  it('names variants and keeps each graph with its own results', () => {
    expect(defaultName(0)).toBe('База');
    expect(defaultName(2)).toBe('Вариант Б');
    const base = doc('primary');
    useEditor.getState().load(base, 'a.osm');
    useScenarios.getState().save('');
    useSim.setState({ result: sim(40) });
    expect(useScenarios.getState().list[0].micro?.delay).toBe(40);

    useEditor.getState().apply(() => doc('secondary'));
    useScenarios.getState().save('');
    useSim.setState({ result: sim(25) });
    const [a, b] = useScenarios.getState().list;
    expect(b.name).toBe('Вариант А');
    expect(b.micro?.delay).toBe(25);
    expect(a.micro?.delay).toBe(40);

    useScenarios.getState().switchTo(a.id);
    expect(useEditor.getState().doc).toBe(base);
    expect(useSim.getState().result).toBeNull();
    expect(useScenarios.getState().list[1].doc.ways.w.tags.highway).toBe('secondary');
  });

  it('starts over when another file is opened', () => {
    useEditor.getState().load(doc('tertiary'), 'b.osm');
    expect(useScenarios.getState().list).toHaveLength(0);
  });
});
