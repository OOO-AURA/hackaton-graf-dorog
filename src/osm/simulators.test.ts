import { howSimulatorsRead, lanesPerDirection } from './simulators';

describe('how the simulators read a road', () => {
  test('lanes per direction as measured on the task fragment', () => {
    expect(lanesPerDirection({ highway: 'primary', lanes: '3', oneway: 'yes' })).toEqual({ forward: 3, backward: 0 });
    expect(lanesPerDirection({ highway: 'secondary', lanes: '4' })).toEqual({ forward: 2, backward: 2 });
    expect(lanesPerDirection({ highway: 'secondary', lanes: '5', 'lanes:forward': '3', 'lanes:backward': '2' })).toEqual({ forward: 3, backward: 2 });
    expect(lanesPerDirection({ highway: 'residential', lanes: '2' })).toEqual({ forward: 1, backward: 1 });
    expect(lanesPerDirection({ highway: 'residential' })).toEqual({ forward: 1, backward: 1 });
    expect(lanesPerDirection({ highway: 'primary', lanes: '2', oneway: '-1' })).toEqual({ forward: 0, backward: 2 });
  });

  test('MATSim capacity is lanes × the per-lane value of the class', () => {
    expect(howSimulatorsRead({ highway: 'primary', lanes: '4', oneway: 'yes', maxspeed: '60' }).matsim).toEqual({ speed: 60, lanes: '4', capacity: 6000 });
    expect(howSimulatorsRead({ highway: 'secondary', lanes: '4' }).matsim).toEqual({ speed: 30, lanes: '2 + 2', capacity: 2000 });
    expect(howSimulatorsRead({ highway: 'secondary_link', oneway: 'yes' }).matsim?.capacity).toBe(1000);
    expect(howSimulatorsRead({ highway: 'residential' }).matsim?.capacity).toBe(600);
  });

  test('SUMO speed and Webots height come from the same tags', () => {
    const v = howSimulatorsRead({ highway: 'secondary', lanes: '4' });
    expect(v.sumo).toEqual({ speed: 100, lanes: '2 + 2' });
    expect(v.webots).toBe(0);
    expect(howSimulatorsRead({ highway: 'service' }).matsim).toBeNull();
    expect(howSimulatorsRead({ highway: 'primary', bridge: 'yes', layer: '1' }).webots).toBe(5);
    expect(howSimulatorsRead({ highway: 'primary', tunnel: 'yes', layer: '-1' }).webots).toBeNull();
  });
});
