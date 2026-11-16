import {
  deepEqual,
  isFileType,
  isRecord,
  isTextType,
  type Json,
  type ValueType
} from '@ugula/graph';
import { useContext, useState } from 'react';
import { classNamesOf } from '../class-names.ts';
import { labelFromName } from '../format.ts';
import { describeType, ValueKindsContext } from '../graph/pins.ts';
import { Checkbox } from './checkbox.tsx';
import { describedByOf, Field, FieldSet, fieldControlClasses, fieldTextClasses } from './field.tsx';
import { Input } from './input.tsx';
import { ListRows } from './list-rows.tsx';
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
  editable?: boolean | undefined;
};

type UploadedValue = { file: Json; name: string };

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
    return { error: 'This is not valid JSON yet.' };
  }
};

const formatJson = (value: Json) => (value === null ? '' : JSON.stringify(value, null, 2));

type JsonFieldProps = {
  id: string;
  label: string;
  value: Json;
  onChange: (value: Json) => void;
  hint?: string | undefined;
  error?: string | undefined;
  disabled?: boolean | undefined;
};

export const JsonField = ({
  id,
  label,
  value,
  onChange,
  hint,
  error,
  disabled
}: JsonFieldProps) => {
  const [text, setText] = useState(() => formatJson(value));
  const parsed = parseJson(text);
  const isCurrent = 'error' in parsed || deepEqual(parsed.value, value);
  return (
    <Textarea
      isMonospace
      id={id}
      label={label}
      hint={hint}
      error={('error' in parsed ? parsed.error : undefined) ?? error}
      disabled={disabled}
      value={isCurrent ? text : formatJson(value)}
      onChange={(e) => {
        setText(e.target.value);
        const next = parseJson(e.target.value);
        if ('value' in next) onChange(next.value);
      }}
    />
  );
};

const RecordField = ({
  id,
  label,
  fields,
  value,
  onChange,
  editable
}: Pick<ValueFieldProps, 'id' | 'label' | 'value' | 'onChange' | 'editable'> & {
  fields: Record<string, ValueType>;
}) => {
  const record = isRecord(value) ? value : {};
  return (
    <FieldSet label={label}>
      {Object.entries(fields).map(([name, type]) => (
        <ValueField
          key={name}
          id={`${id}-${name}`}
          label={labelFromName(name)}
          type={type}
          value={record[name] ?? null}
          editable={editable}
          onChange={(next) => onChange({ ...record, [name]: next })}
        />
      ))}
    </FieldSet>
  );
};

const ItemsField = ({
  id,
  label,
  item,
  value,
  onChange,
  editable = true
}: Pick<ValueFieldProps, 'id' | 'label' | 'value' | 'onChange' | 'editable'> & {
  item: ValueType;
}) => (
  <FieldSet label={label}>
    <ListRows<Json>
      id={id}
      noun="Item"
      items={Array.isArray(value) ? value : []}
      editable={editable}
      blank={() => null}
      onChange={onChange}
    >
      {(x, i, set) => (
        <ValueField
          id={`${id}-${i}`}
          label={`Item ${i + 1}`}
          type={item}
          value={x}
          editable={editable}
          onChange={set}
        />
      )}
    </ListRows>
  </FieldSet>
);

const ANY_KINDS = [
  { value: 'string', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Yes or No' },
  { value: 'json', label: 'JSON' }
] as const;

type AnyKind = (typeof ANY_KINDS)[number]['value'];

export const anyKindOf = (value: Json): AnyKind =>
  typeof value === 'number'
    ? 'number'
    : typeof value === 'boolean'
      ? 'boolean'
      : value === null || typeof value === 'string'
        ? 'string'
        : 'json';

const convertedTo = (kind: AnyKind, value: Json): Json =>
  kind === 'json' || anyKindOf(value) === kind ? value : kind === 'boolean' ? false : null;

const AnyField = (props: ValueFieldProps) => {
  const { id, label, value, onChange } = props;
  const [kind, setKind] = useState(() => anyKindOf(value));
  return (
    <FieldSet label={label}>
      <Select
        id={`${id}-kind`}
        label="Kind of Value"
        options={ANY_KINDS}
        value={kind}
        onChange={(next) => {
          const chosen = ANY_KINDS.find((k) => k.value === next)?.value ?? 'string';
          setKind(chosen);
          onChange(convertedTo(chosen, value));
        }}
      />
      {kind === 'json' ? (
        <JsonField id={id} label="JSON" value={value} error={props.error} onChange={onChange} />
      ) : (
        <ValueField {...props} label={kind === 'boolean' ? 'Yes' : 'Value'} type={kind} />
      )}
    </FieldSet>
  );
};

export const linesOf = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

const isStringList = (type: ValueType) =>
  typeof type === 'object' && 'list' in type && isTextType(type.list);

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
  const kinds = useContext(ValueKindsContext);
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
        onChange={(v) => onChange(v || null)}
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
  if (isTextType(type)) {
    return (
      <Input
        {...common}
        hint={type === 'string' ? undefined : describeType(type, kinds)}
        value={textOf(value)}
        onChange={(e) => onChange(e.target.value || null)}
      />
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
  if (typeof type === 'object' && 'list' in type) return <ItemsField {...props} item={type.list} />;
  if (typeof type === 'object' && 'object' in type && Object.keys(type.object).length) {
    return <RecordField {...props} fields={type.object} />;
  }
  if (type === 'any') return <AnyField {...props} />;
  return (
    <JsonField
      id={id}
      label={label}
      hint={describeType(type, kinds)}
      value={value}
      error={error}
      onChange={onChange}
    />
  );
};
