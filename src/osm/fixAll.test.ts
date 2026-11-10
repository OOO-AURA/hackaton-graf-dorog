import { readFileSync } from 'node:fs';
import { parseOsm } from './parse';
import { fixAll } from './fixAll';
import { validate } from './validate';

describe('fixAll', () => {
  test('leaves the task fragment with far fewer issues and keeps it valid', () => {
    const doc = parseOsm(readFileSync('public/example.osm', 'utf8'));
    const t0 = performance.now();
    const r = fixAll(doc);
    const ms = performance.now() - t0;
    console.log(`fixAll: ${r.before} -> ${r.after} issues, errors after ${r.errorsAfter}, ${Math.round(ms)} ms`);
    expect(r.after).toBeLessThan(r.before / 2);
    expect(validate(r.doc).issues.filter((i) => i.fix)).toEqual([]);
    expect(doc).not.toBe(r.doc);
  }, 60_000);
});
