import { lanesByDirection } from '../osm/profile';
import { direction } from '../osm/tags';
import type { Tags } from '../osm/types';

const TURN_GLYPH: Readonly<Record<string, string>> = {
  left: '↰', slight_left: '↖', sharp_left: '↰', through: '↑', right: '↱', slight_right: '↗', sharp_right: '↱', reverse: '↶', merge_to_left: '↖', merge_to_right: '↗',
};

const glyphs = (turn: string) => (turn ? turn.split(';').map((t) => TURN_GLYPH[t] ?? '').join('') : '') || '↑';

/** One lane cell: a button when lanes can be picked for editing. */
function Cell({ back, on, onPick, glyph }: { back: boolean; on: boolean; onPick?: () => void; glyph: string }) {
  const cls = `lane${back ? ' back' : ''}${on ? ' on' : ''}`;
  return onPick
    ? <button type="button" className={cls} onClick={onPick} aria-pressed={on} title="Править эту полосу"><i>{glyph}</i></button>
    : <span className={cls}><i>{glyph}</i></span>;
}

/**
 * Cross-section of the carriageway as the map draws it: one cell per lane, oncoming lanes on the
 * left, turn arrows from turn:lanes (`:forward` / `:backward` on a two-way road). Oncoming lanes
 * are listed from their own left, so seen from this direction they read right to left, upside down.
 */
export interface LanePick { readonly travel: 'forward' | 'backward'; readonly index: number }

export function LaneStrip({ tags, selected, onPick }: { tags: Tags; selected?: LanePick | null; onPick?: (lane: LanePick) => void }) {
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
      {two && Array.from({ length: backward }, (_, i) => {
        const index = backward - 1 - i;
        return <Cell key={`b${i}`} back on={selected?.travel === 'backward' && selected.index === index} onPick={onPick && (() => onPick({ travel: 'backward', index }))} glyph={glyphs(back[index] ?? '')} />;
      })}
      {two && <span className="lane-divider" aria-hidden="true" />}
      {Array.from({ length: forward }, (_, i) => {
        const travel = dir === 'backward' ? 'backward' : 'forward';
        return <Cell key={`f${i}`} back={dir === 'backward'} on={selected?.travel === travel && selected.index === i} onPick={onPick && (() => onPick({ travel, index: i }))} glyph={glyphs(ahead[i] ?? '')} />;
      })}
    </div>
  );
}
