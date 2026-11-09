import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bridgeFeatures, deckHeight, LAYER_HEIGHT_M, RAMP_LENGTH_M } from './bridges3d';
import { parseOsm } from '../osm/parse';
import type { OsmWay } from '../osm/types';

/**
 * A street going west → east over a bridge (way 2, 60 m) with 100 m approaches on both sides,
 * and a ramp joining at the west end without a name.
 */
const XML = `<osm version="0.6">
  <node id="1" lat="52.0" lon="104.0000"/><node id="2" lat="52.0" lon="104.0015"/>
  <node id="3" lat="52.0" lon="104.00238"/><node id="4" lat="52.0" lon="104.00385"/>
  <node id="5" lat="52.0009" lon="104.0015"/>
  <way id="1"><nd ref="1"/><nd ref="2"/><tag k="highway" v="secondary"/><tag k="name" v="Лермонтова"/></way>
  <way id="2"><nd ref="2"/><nd ref="3"/><tag k="highway" v="secondary"/><tag k="name" v="Лермонтова"/><tag k="bridge" v="yes"/><tag k="layer" v="1"/><tag k="lanes" v="4"/></way>
  <way id="3"><nd ref="3"/><nd ref="4"/><tag k="highway" v="secondary"/><tag k="name" v="Лермонтова"/></way>
  <way id="4"><nd ref="5"/><nd ref="2"/><tag k="highway" v="secondary_link"/></way>
  <way id="5"><nd ref="1"/><nd ref="4"/><tag k="highway" v="footway"/><tag k="bridge" v="yes"/><tag k="layer" v="2"/></way>
</osm>`;

describe('bridgeFeatures', () => {
  const fc = bridgeFeatures(parseOsm(XML));
  const of = (wayId: string, part: string) => fc.features.filter((f) => f.properties.wayId === wayId && f.properties.part === part);

  test('deck sits at layer × 5 m like the Webots importer', () => {
    const deck = of('2', 'deck');
    expect(deck).toHaveLength(1);
    expect(deck[0].properties.height).toBe(LAYER_HEIGHT_M);
    expect(deck[0].properties.base).toBeCloseTo(LAYER_HEIGHT_M - 1.2);
    expect(of('5', 'deck')[0].properties.height).toBe(2 * LAYER_HEIGHT_M);
  });

  test('approach embankments descend smoothly to the ground on both ends', () => {
    const ramps = of('2', 'ramp');
    expect(ramps.length).toBeGreaterThan(30);
    const heights = ramps.map((f) => f.properties.height);
    expect(Math.max(...heights)).toBeLessThanOrEqual(LAYER_HEIGHT_M);
    expect(Math.max(...heights)).toBeGreaterThan(LAYER_HEIGHT_M * 0.9);
    expect(Math.min(...heights)).toBeLessThan(0.5);
    const firstSide = heights.slice(0, ramps.length / 2);
    expect(firstSide.every((h, i) => i === 0 || h < firstSide[i - 1])).toBe(true);
  });

  test('the ramp follows the same street, not the unnamed link', () => {
    const rampLats = of('2', 'ramp').flatMap((f) => f.geometry.coordinates[0].map(([, lat]) => lat));
    expect(Math.max(...rampLats)).toBeLessThan(52.0002);
  });

  test('piers stand under the deck, as tall as the deck base', () => {
    const piers = of('2', 'pier');
    expect(piers.length).toBeGreaterThanOrEqual(2);
    piers.forEach((p) => expect(p.properties).toMatchObject({ base: 0, height: LAYER_HEIGHT_M - 1.2 }));
  });

  test('a footbridge does not get a road ramp', () => {
    expect(of('5', 'ramp')).toHaveLength(0);
  });

  test('deck height reads the layer tag', () => {
    const way = (layer?: string): OsmWay => ({ id: 'x', refs: [], attrs: {}, tags: layer ? { bridge: 'yes', layer } : { bridge: 'yes' } });
    expect(deckHeight(way())).toBe(5);
    expect(deckHeight(way('2'))).toBe(10);
    expect(deckHeight(way('-1'))).toBe(5);
    expect(RAMP_LENGTH_M).toBeGreaterThan(50);
  });

  test('the Lermontova overpass in the task fragment gets a deck and ramps', () => {
    const doc = parseOsm(readFileSync(resolve(__dirname, '../test/example.osm'), 'utf8'));
    const real = bridgeFeatures(doc).features.filter((f) => f.properties.wayId === '81608266');
    expect(real.filter((f) => f.properties.part === 'deck').length).toBeGreaterThan(0);
    expect(real.filter((f) => f.properties.part === 'ramp').length).toBeGreaterThan(20);
  });
});
