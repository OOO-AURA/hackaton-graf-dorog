import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyLegalSpeeds, legalSpeed, legalSpeedTags, simulatorSpeeds, speedMismatches } from './speeds';
import { parseOsm } from './parse';

describe('speeds the simulators agree on', () => {
  test('defaults measured on the task fragment', () => {
    expect(simulatorSpeeds({ highway: 'secondary' })).toEqual({ matsim: 30, sumo: 100 });
    expect(simulatorSpeeds({ highway: 'residential' })).toEqual({ matsim: 15, sumo: 50 });
    expect(simulatorSpeeds({ highway: 'primary', maxspeed: 'RU:urban' })).toEqual({ matsim: 80, sumo: 60 });
    expect(simulatorSpeeds({ highway: 'primary', maxspeed: '60' })).toEqual({ matsim: 60, sumo: 60 });
  });

  test('legal speed by ПДД 10.2 in a settlement', () => {
    expect(legalSpeed({ highway: 'residential' })).toEqual({ kmh: 60, zone: 'RU:urban' });
    expect(legalSpeed({ highway: 'service' })).toEqual({ kmh: 20, zone: 'RU:living_street' });
    expect(legalSpeed({ highway: 'living_street' }).kmh).toBe(20);
    expect(legalSpeed({ highway: 'primary', maxspeed: 'RU:urban' }).kmh).toBe(60);
  });

  test('the fix writes a number and keeps the zone in source:maxspeed', () => {
    expect(legalSpeedTags({ highway: 'primary', maxspeed: 'RU:urban' })).toEqual({ highway: 'primary', maxspeed: '60', 'source:maxspeed': 'RU:urban' });
    expect(legalSpeedTags({ highway: 'residential', 'source:maxspeed': 'sign' })).toMatchObject({ maxspeed: '60', 'source:maxspeed': 'sign' });
    const already = { highway: 'primary', maxspeed: '40' };
    expect(legalSpeedTags(already)).toBe(already);
  });

  test('on the task fragment most roads disagree, and the fix leaves none', () => {
    const doc = parseOsm(readFileSync(resolve(__dirname, '../test/example.osm'), 'utf8'));
    const found = speedMismatches(doc);
    expect(found.length).toBeGreaterThan(30);
    expect(found.some((m) => doc.ways[m.wayId].tags.highway === 'service' && !doc.ways[m.wayId].tags.maxspeed)).toBe(false);
    console.info('speed mismatches on example.osm:', found.length);
    const fixed = applyLegalSpeeds(doc, found.map((m) => m.wayId));
    expect(speedMismatches(fixed)).toHaveLength(0);
    expect(applyLegalSpeeds(fixed, [])).toBe(fixed);
  });
});
