import type { OsmNode } from '../osm/types';
import { useEditor } from '../state/store';
import { setNodeTags } from '../osm/edit';
import { withTag } from '../osm/tags';
import { removeSign, signDef, signsOf } from '../osm/trafficSigns';
import { signUrl } from '../map/signArt';
import { Section } from './Section';

/**
 * Road signs on a node (traffic_sign): each with its picture, the number on it where it has one,
 * the side of the road it faces, and a button to take it off. The node stays a point of the road.
 */
export function SignSection({ node }: { node: OsmNode }) {
  const apply = useEditor((s) => s.apply);
  const signs = signsOf(node.tags);
  if (!signs.length) return null;
  const write = (next: Array<{ code: string; value?: number }>) => apply((d) => setNodeTags(d, node.id,
    withTag(d.nodes[node.id].tags, 'traffic_sign', next.length ? next.map((s) => `RU:${s.code}${s.value !== undefined ? `[${s.value}]` : ''}`).join(';') : null)));
  const forward = node.tags.direction !== 'backward';
  return (
    <Section title="Знаки" aside={<span className="mono count">{signs.length}</span>}>
      <ul className="sign-list">
        {signs.map((s, i) => {
          const def = signDef(s.code);
          return (
            <li key={`${s.code}${i}`}>
              <img src={signUrl(`ts:${s.code}${s.value !== undefined ? `:${s.value}` : ''}`)} alt="" width={30} height={30} />
              <span><b>{s.code}</b> {def?.name ?? 'знак'}</span>
              {def?.value && (
                <input type="number" min={5} max={130} step={5} defaultValue={s.value ?? def.value.default} key={s.value} aria-label={def.value.label}
                  onBlur={(e) => write(signs.map((x, k) => (k === i ? { ...x, value: Number(e.target.value) || def.value!.default } : x)))} />
              )}
              <button className="icon-btn" onClick={() => apply((d) => removeSign(d, node.id, s.code))} title="Убрать знак" aria-label={`Убрать знак ${s.code}`}>✕</button>
            </li>
          );
        })}
      </ul>
      <div className="buttons">
        <button className="btn btn-sm" onClick={() => apply((d) => setNodeTags(d, node.id, withTag(d.nodes[node.id].tags, 'direction', forward ? 'backward' : 'forward')))}
          title="Знак встанет на другую сторону дороги, для встречного направления">⇄ Для встречного направления</button>
      </div>
      <p className="hint">Пишется тегом <code>traffic_sign=RU:…</code> и <code>direction={forward ? 'forward' : 'backward'}</code>. Узел тянется вдоль дороги, дорога не гнётся.</p>
    </Section>
  );
}
