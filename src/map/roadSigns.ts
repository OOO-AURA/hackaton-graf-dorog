import type { Map as MapLibreMap } from 'maplibre-gl';
import type { SignKind } from '../osm/signs';
import { signBitmap } from './signArt';

/**
 * Road sign images in the look of GOST R 52290: 2.4 give way, 2.5 stop, 2.1 main road and 5.19.1
 * pedestrian crossing. Drawn once on a canvas; the map shows them in 2D next to the road.
 */

const KINDS: readonly SignKind[] = ['give_way', 'stop', 'main_road', 'crossing'];

export const signImageId = (sign: SignKind) => `road-sign-${sign}`;

export function addRoadSignImages(map: MapLibreMap): void {
  KINDS.forEach((sign) => {
    void signBitmap(sign, 96).then((img) => {
      if (img && !map.hasImage(signImageId(sign))) map.addImage(signImageId(sign), img, { pixelRatio: 4 });
    });
  });
}
