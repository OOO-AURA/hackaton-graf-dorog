import { bandOf, speedOf, thematicExpression, thematicProps } from './thematic';

describe('thematic road colouring', () => {
  test('reads lanes, implicit and numeric speed limits and missing attributes', () => {
    expect(thematicProps({ highway: 'primary', lanes: '4', maxspeed: 'RU:urban' })).toMatchObject({ tLanes: 4, tSpeed: 60, tMissing: 0 });
    expect(thematicProps({ highway: 'residential' })).toMatchObject({ tLanes: 0, tSpeed: 0, tMissing: 2 });
    expect(thematicProps({ highway: 'service', maxspeed: '20' }).tMissing).toBe(1);
    expect(speedOf({ maxspeed: 'RU:living_street' })).toBe(20);
    expect(speedOf({ maxspeed: 'none' })).toBe(0);
  });

  test('bands cover every value', () => {
    expect(bandOf('lanes', 0).label).toBe('не указано');
    expect(bandOf('lanes', 7).label).toBe('5+');
    expect(bandOf('speed', 60).label).toBe('50–60');
    expect(bandOf('capacity', 2400).label).toBe('2400–3599');
    expect(bandOf('missing', 2).label).toBe('нет ни полос, ни скорости');
  });

  test('the map expression is a case over the band thresholds', () => {
    const e = thematicExpression('lanes') as unknown[];
    expect(e[0]).toBe('case');
    expect(e).toHaveLength(1 + 5 * 2 + 1);
  });
});
