import { lanesByDirection } from '../osm/profile';
import { direction } from '../osm/tags';
import type { Tags } from '../osm/types';

const TURN_GLYPH: Readonly<Record<string, string>> = {
  left: '↰', slight_left: '↖', sharp_left: '↰', through: '↑', right: '↱', slight_right: '↗', sharp_right: '↱', reverse: '↶', merge_to_left: '↖', merge_to_right: '↗',
};

const glyphs = (turn: string) => (turn ? turn.split(';').map((t) => TURN_GLYPH[t] ?? '').join('') : '') || '↑';

/**
 * Cross-section of the carriageway as the map draws it: one cell per lane, oncoming lanes on the
 * left, turn arrows from turn:lanes (`:forward` / `:backward` on a two-way road). Oncoming lanes
 * are listed from their own left, so seen from this direction they read right to left, upside down.
 */
export function LaneStrip({ tags }: { tags: Tags }) {
  const dir = direction(tags);
  const { forward, backward } = lanesByDirection(tags);
  const total = forward + backward;
  if (total > 12) return null;
  const split = (key: string) => (tags[key] ?? '').split('|');
  const two = dir === 'both';
  const ahead = split(two ? 'turn:lanes:forward' : 'turn:lanes');
  const back = split('turn:lanes:backward');
  return (
    <div className="lane-strip" aria-label={`Полос: ${total}`}>
      {two && Array.from({ length: backward }, (_, i) => <span key={`b${i}`} className="lane back"><i>{glyphs(back[backward - 1 - i] ?? '')}</i></span>)}
      {two && <span className="lane-divider" aria-hidden="true" />}
      {Array.from({ length: forward }, (_, i) => <span key={`f${i}`} className={`lane${dir === 'backward' ? ' back' : ''}`}><i>{glyphs(ahead[i] ?? '')}</i></span>)}
    </div>
  );
}
