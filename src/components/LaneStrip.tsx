import { direction } from '../osm/tags';
import type { Tags } from '../osm/types';

const TURN_GLYPH: Readonly<Record<string, string>> = {
  left: '↰', slight_left: '↖', sharp_left: '↰', through: '↑', right: '↱', slight_right: '↗', sharp_right: '↱', reverse: '↶', merge_to_left: '↖', merge_to_right: '↗',
};

const glyphs = (turn: string) => (turn ? turn.split(';').map((t) => TURN_GLYPH[t] ?? '').join('') : '') || '↑';

/** Cross-section of the carriageway: one cell per lane, oncoming lanes on the left, turn arrows from turn:lanes. */
export function LaneStrip({ tags }: { tags: Tags }) {
  const dir = direction(tags);
  const total = Number.parseInt(tags.lanes ?? '', 10) || (dir === 'both' ? 2 : 1);
  const fwdTagged = Number.parseInt(tags['lanes:forward'] ?? '', 10);
  const forward = dir === 'both' ? (Number.isFinite(fwdTagged) ? Math.min(Math.max(fwdTagged, 0), total) : Math.ceil(total / 2)) : total;
  const backward = Math.max(0, total - forward);
  const turns = (tags['turn:lanes'] ?? tags['turn:lanes:forward'] ?? '').split('|');
  if (total > 12) return null;
  return (
    <div className="lane-strip" aria-label={`Полос: ${total}`}>
      {Array.from({ length: backward }, (_, i) => <span key={`b${i}`} className="lane back">↓</span>)}
      {backward > 0 && <span className="lane-divider" aria-hidden="true" />}
      {Array.from({ length: forward }, (_, i) => <span key={`f${i}`} className="lane">{dir === 'backward' ? '↓' : glyphs(turns[i] ?? '')}</span>)}
    </div>
  );
}
