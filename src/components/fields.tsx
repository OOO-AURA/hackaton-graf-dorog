import { useEffect, useState } from 'react';

interface TextFieldProps {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'number';
  list?: string;
}

/** Input that commits on blur/Enter so typing does not create one undo step per keystroke. */
export function TextField({ label, value, onCommit, placeholder, type = 'text', list }: TextFieldProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => { if (draft !== value) onCommit(draft.trim()); };
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type={type} value={draft} placeholder={placeholder} list={list} min={type === 'number' ? 0 : undefined}
        onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
    </label>
  );
}

interface SelectFieldProps {
  label: string;
  value: string;
  options: ReadonlyArray<readonly [string, string]>;
  onChange: (value: string) => void;
}

export function SelectField({ label, value, options, onChange }: SelectFieldProps) {
  const known = options.some(([v]) => v === value);
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {!known && <option value={value}>{value || '—'}</option>}
        {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
    </label>
  );
}
