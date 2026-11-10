import type { Turn } from '../osm/lanes';

/** Arrows standing for each turn on the lane buttons. */
export const TURN_GLYPHS: Readonly<Record<Turn, string>> = {
  sharp_left: '↙', left: '←', slight_left: '↖', through: '↑', slight_right: '↗', right: '→', sharp_right: '↘', reverse: '↶',
};
