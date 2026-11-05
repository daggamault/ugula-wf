import { formatType, type Json, type ValueType } from '@ugula/graph';
import { useState } from 'react';
import { classNamesOf } from '../class-names.ts';
import { Checkbox } from './checkbox.tsx';
import { describedByOf, Field, fieldControlClasses, fieldTextClasses } from './field.tsx';
import { Input } from './input.tsx';
import { Select, type SelectOption } from './select.tsx';
import { Textarea } from './textarea.tsx';

type ValueFieldProps = {
  id: string;
  label: string;
  type: ValueType;
  value: Json;
  onChange: (value: Json) => void;
  error?: string | undefined;
  isRequired?: boolean | undefined;
  format?: 'date' | undefined;
  min?: number | undefined;
  max?: number | undefined;
  options?: readonly SelectOption[] | undefined;
  upload?: ((file: File) => Promise<UploadedValue>) | undefined;
};

type UploadedValue = { file: Json; name: string };

export const isFileType = (type: ValueType) =>
  typeof type === 'object' &&
  'object' in type &&
  Object.keys(type.object).sort().join(',') === 'bucket,key';

const FileField = ({
  id,
  label,
  error,
  onChange,
  upload
}: Pick<ValueFieldProps, 'id' | 'label' | 'error' | 'onChange'> & {
  upload: (file: File) => Promise<UploadedValue>;
}) => {
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const shown = failure ?? error;
  const hint = busy ? 'Uploading…' : name ? `Uploaded ${name}` : 'Choose a file to upload.';
  return (
    <Field id={id} label={label} error={shown} hint={hint}>
      <input
        id={id}
        type="file"
        disabled={busy}
        aria-invalid={Boolean(shown) || undefined}
        aria-describedby={describedByOf(id, shown, hint)}
        className={classNamesOf(
          fieldControlClasses,
          fieldTextClasses,
          'file:border-border file:bg-surface hover:file:bg-surface-hover file:text-surface-fg h-10 cursor-pointer py-1 pl-1 file:mr-3 file:h-8 file:cursor-pointer file:rounded-lg file:border file:px-3 file:text-sm file:font-semibold file:transition file:duration-150'
        )}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setBusy(true);
          setFailure(undefined);
          try {
            const uploaded = await upload(file);
            setName(uploaded.name);
            onChange(uploaded.file);
          } catch (err) {
            setName(null);
            onChange(null);
            setFailure(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      />
    </Field>
  );
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
      isMonospace
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

export const linesOf = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

const isStringList = (type: ValueType) =>
  typeof type === 'object' && 'list' in type && type.list === 'string';

const ListField = ({ id, label, value, onChange, error, isRequired }: ValueFieldProps) => {
  const [text, setText] = useState(() =>
    Array.isArray(value) ? value.filter((v) => typeof v === 'string').join('\n') : ''
  );
  return (
    <Textarea
      id={id}
      label={label}
      hint="One per line."
      error={error}
      required={isRequired}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(linesOf(e.target.value));
      }}
    />
  );
};

const textOf = (value: Json) => (typeof value === 'string' ? value : '');

export const ValueField = (props: ValueFieldProps) => {
  const { id, label, type, value, onChange, error, isRequired, format, min, max, options, upload } =
    props;
  const common = { id, label, error, required: isRequired };
  if (upload && isFileType(type)) {
    return <FileField id={id} label={label} error={error} onChange={onChange} upload={upload} />;
  }
  if (options) {
    return (
      <Select
        {...common}
        options={[{ value: '', label: 'Choose…' }, ...options]}
        value={textOf(value)}
        onChange={(e) => onChange(e.target.value || null)}
      />
    );
  }
  if (type === 'boolean') {
    return (
      <label htmlFor={id} className="flex cursor-pointer items-center gap-2 text-sm font-medium">
        <Checkbox id={id} checked={value === true} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
    );
  }
  if (type === 'number' || type === 'integer') {
    return (
      <Input
        {...common}
        type="number"
        inputMode={type === 'integer' ? 'numeric' : 'decimal'}
        step={type === 'integer' ? 1 : 'any'}
        min={min}
        max={max}
        value={typeof value === 'number' ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
    );
  }
  if (type === 'string' && format === 'date') {
    return (
      <Input
        {...common}
        type="date"
        value={textOf(value)}
        onChange={(e) => onChange(e.target.value || null)}
      />
    );
  }
  if (type === 'string') {
    return (
      <Input {...common} value={textOf(value)} onChange={(e) => onChange(e.target.value || null)} />
    );
  }
  if (type === 'datetime') {
    return (
      <Input
        {...common}
        type="datetime-local"
        hint="UTC"
        value={textOf(value).slice(0, 16)}
        onChange={(e) =>
          onChange(e.target.value ? new Date(`${e.target.value}Z`).toISOString() : null)
        }
      />
    );
  }
  if (isStringList(type)) return <ListField {...props} />;
  return <JsonField {...props} />;
};
