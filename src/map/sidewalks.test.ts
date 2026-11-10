import type { Feature, LineString } from 'geojson';
import { sidewalkLines } from './sidewalks';

type Props = Record<string, string | number | boolean>;
const road = (coords: number[][], props: Props = {}): Feature<LineString, Props> => ({
  type: 'Feature', properties: { sw: 'lr', sl17: -12, sr17: 12, s17: 5, bridge: false, tunnel: false, taper: false, ...props },
  geometry: { type: 'LineString', coordinates: coords },
});
const fc = (features: Feature<LineString, Props>[]) => ({ type: 'FeatureCollection' as const, features });

describe('sidewalk lines', () => {
  test('two pieces of a street meeting at a bend become one line', () => {
    const lines = sidewalkLines(fc([road([[0, 0], [1, 0]]), road([[1, 0], [2, 1]])])).features;
    expect(lines).toHaveLength(1);
    expect(lines[0].geometry.coordinates).toEqual([[0, 0], [1, 0], [2, 1]]);
  });

  test('a piece drawn the other way is turned round, and its sides swap with it', () => {
    const lines = sidewalkLines(fc([road([[0, 0], [1, 0]], { sw: 'l', sl17: -10, sr17: 14 }), road([[2, 1], [1, 0]], { sw: 'r', sl17: -14, sr17: 10 })])).features;
    expect(lines).toHaveLength(1);
    expect(lines[0].geometry.coordinates).toEqual([[0, 0], [1, 0], [2, 1]]);
    expect(lines[0].properties).toMatchObject({ sw: 'l', sl17: -10, sr17: 14 });
  });

  test('at a junction the pieces stay apart, and so do pieces of different widths', () => {
    const junction = sidewalkLines(fc([road([[0, 0], [1, 0]]), road([[1, 0], [2, 0]]), road([[1, 0], [1, 1]])])).features;
    expect(junction).toHaveLength(3);
    const wider = sidewalkLines(fc([road([[0, 0], [1, 0]]), road([[1, 0], [2, 0]], { sr17: 20 })])).features;
    expect(wider).toHaveLength(2);
  });

  test('bridges, tunnels and roads without sidewalks are left out', () => {
    expect(sidewalkLines(fc([road([[0, 0], [1, 0]], { bridge: true }), road([[1, 0], [2, 0]], { sw: '' })])).features).toHaveLength(0);
  });
});
