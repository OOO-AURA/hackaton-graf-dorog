import { DEFAULT_VPH, flowsDemand, MAX_VPH, useCustomFlows } from './customFlows';

describe('own traffic flows', () => {
  beforeEach(() => useCustomFlows.getState().clear());

  test('two clicks place a flow from the first point to the second', () => {
    const s = useCustomFlows.getState();
    s.startPick();
    s.place({ lon: 104.25, lat: 52.26 });
    expect(useCustomFlows.getState().pick).toBe('to');
    useCustomFlows.getState().place({ lon: 104.27, lat: 52.25 });
    const { flows, pick } = useCustomFlows.getState();
    expect(pick).toBeNull();
    expect(flows).toHaveLength(1);
    expect(flows[0]).toMatchObject({ from: { lon: 104.25 }, to: { lon: 104.27 }, vph: DEFAULT_VPH });
  });

  test('the volume stays within limits', () => {
    const s = useCustomFlows.getState();
    s.startPick(); s.place({ lon: 1, lat: 1 }); useCustomFlows.getState().place({ lon: 2, lat: 2 });
    const id = useCustomFlows.getState().flows[0].id;
    useCustomFlows.getState().update(id, { vph: 99_999 });
    expect(useCustomFlows.getState().flows[0].vph).toBe(MAX_VPH);
  });

  test('every flow becomes a pair of zones with its vehicles between them', () => {
    const flows = [
      { id: 1, from: { lon: 1, lat: 1 }, to: { lon: 2, lat: 2 }, vph: 300, label: 'a' },
      { id: 2, from: { lon: 3, lat: 3 }, to: { lon: 1, lat: 1 }, vph: 120, label: 'b' },
    ];
    const d = flowsDemand(flows);
    expect(d.zones).toHaveLength(4);
    expect(d.od[0][1]).toBe(300);
    expect(d.od[2][3]).toBe(120);
    expect(d.od.flat().reduce((s, v) => s + v, 0)).toBe(420);
  });
});
