import { formatType, type Json, type ValueType } from '@ugula/graph';
import { useState } from 'react';
import { Input } from './input.tsx';
import { Select, type SelectOption } from './select.tsx';
import { Textarea } from './textarea.tsx';

export type ValueFieldProps = {
  id: string;
  label: string;
  type: ValueType;
  value: Json;
  onChange: (value: Json) => void;
  error?: string | undefined;
  options?: readonly SelectOption[] | undefined;
};

const parseJson = (text: string): { value: Json } | { error: string } => {
  if (!text.trim()) return { value: null };
  try {
    return { value: JSON.parse(text) as Json };
  } catch {
    return { error: 'Not valid JSON' };
  }
};

const JsonField = ({ id, label, type, value, onChange, error }: ValueFieldProps) => {
  const [text, setText] = useState(() => (value === null ? '' : JSON.stringify(value, null, 2)));
  const [parseError, setParseError] = useState<string>();
  return (
    <Textarea
      id={id}
      label={label}
      hint={formatType(type)}
      error={parseError ?? error}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const parsed = parseJson(e.target.value);
        if ('error' in parsed) setParseError(parsed.error);
        else {
          setParseError(undefined);
          onChange(parsed.value);
        }
      }}
    />
  );
};

export const ValueField = (props: ValueFieldProps) => {
  const { id, label, type, value, onChange, error, options } = props;
  if (options) {
    return (
      <Select
        id={id}
        label={label}
        error={error}
        options={[{ value: '', label: 'Choose…' }, ...options]}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value || null)}
      />
    );
  }
  if (type === 'boolean') {
    return (
      <label htmlFor={id} className="flex cursor-pointer items-center gap-3 text-sm font-medium">
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          className="accent-primary size-4 cursor-pointer"
        />
        {label}
      </label>
    );
  }
  if (type === 'number' || type === 'integer') {
    return (
      <Input
        id={id}
        label={label}
        type="number"
        step={type === 'integer' ? 1 : 'any'}
        error={error}
        value={typeof value === 'number' ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
    );
  }
  if (type === 'string' || type === 'datetime') {
    const isTime = type === 'datetime';
    return (
      <Input
        id={id}
        label={label}
        type={isTime ? 'datetime-local' : 'text'}
        hint={isTime ? 'UTC' : undefined}
        error={error}
        value={typeof value === 'string' ? (isTime ? value.slice(0, 16) : value) : ''}
        onChange={(e) =>
          onChange(
            e.target.value === ''
              ? null
              : isTime
                ? new Date(`${e.target.value}Z`).toISOString()
                : e.target.value
          )
        }
      />
    );
  }
  return <JsonField {...props} />;
};
