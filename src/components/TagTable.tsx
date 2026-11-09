import { useState } from 'react';
import type { Tags } from '../osm/types';

interface Props {
  tags: Tags;
  onChange: (tags: Tags) => void;
}

/** Raw OSM tag editor: any attribute the form does not cover can be edited here. */
export function TagTable({ tags, onChange }: Props) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const remove = (k: string) => {
    const { [k]: _removed, ...rest } = tags;
    onChange(rest);
  };
  const add = () => {
    if (!key.trim() || !value.trim()) return;
    onChange({ ...tags, [key.trim()]: value.trim() });
    setKey('');
    setValue('');
  };
  return (
    <div className="tags">
      <table>
        <tbody>
          {Object.entries(tags).map(([k, v]) => (
            <tr key={k}>
              <td className="k">{k}</td>
              <td>
                <input defaultValue={v} key={v} onBlur={(e) => { if (e.target.value !== v) onChange({ ...tags, [k]: e.target.value }); }} />
              </td>
              <td><button className="icon" title="Удалить тег" onClick={() => remove(k)}>×</button></td>
            </tr>
          ))}
          <tr>
            <td><input placeholder="ключ" value={key} onChange={(e) => setKey(e.target.value)} /></td>
            <td><input placeholder="значение" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} /></td>
            <td><button className="icon" title="Добавить тег" onClick={add}>+</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
