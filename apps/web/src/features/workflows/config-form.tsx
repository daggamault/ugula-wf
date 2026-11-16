import { isRecord, type Json } from '@ugula/graph';
import * as v from 'valibot';
import { labelFromName } from '../../shared/format.ts';
import { TypePicker } from '../../shared/graph/type-picker.tsx';
import { Checkbox } from '../../shared/ui/checkbox.tsx';
import { FieldSet } from '../../shared/ui/field.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { ListRows } from '../../shared/ui/list-rows.tsx';
import { Select } from '../../shared/ui/select.tsx';
import { JsonField, ValueField } from '../../shared/ui/value-field.tsx';
import {
  asValueType,
  blankOf,
  type FormEntry,
  type FormShape,
  recordOf,
  shapeOf,
  singular,
  withEntry
} from './config-schema.ts';

type Errors = Readonly<Record<string, readonly string[] | undefined>>;

type ShapeFieldProps = {
  id: string;
  path: string;
  label: string;
  shape: FormShape;
  value: Json | undefined;
  entry?: FormEntry | undefined;
  editable: boolean;
  errors: Errors;
  onChange: (value: Json | undefined) => void;
};

export const choiceLabel = (option: string) =>
  /^[A-Z]+$/.test(option) ? option : labelFromName(option);

type Option = { value: string; label: string };

export const optionsOf = (value: Json | undefined): Option[] =>
  Array.isArray(value)
    ? value.map((o) =>
        typeof o === 'string'
          ? { value: o, label: o }
          : isRecord(o)
            ? { value: String(o.value ?? ''), label: String(o.label ?? '') }
            : { value: '', label: '' }
      )
    : [];

export const optionsJson = (options: readonly Option[]): Json =>
  options.map((o) => (!o.label || o.label === o.value ? o.value : { ...o }));

export const ChoicesField = ({
  id,
  label,
  value,
  editable,
  onChange
}: Pick<ShapeFieldProps, 'id' | 'label' | 'value' | 'editable' | 'onChange'>) => (
  <FieldSet label={label}>
    <ListRows<Option>
      id={id}
      noun="Choice"
      items={optionsOf(value)}
      editable={editable}
      blank={() => ({ value: '', label: '' })}
      nameOf={(o, i) => o.label || o.value || `choice ${i + 1}`}
      onChange={(options) => onChange(optionsJson(options))}
    >
      {(o, i, set) => (
        <div className="grid grid-cols-2 gap-x-4">
          <Input
            id={`${id}-${i}-value`}
            label="Value"
            isMonospace
            value={o.value}
            onChange={(e) => set({ ...o, value: e.target.value })}
          />
          <Input
            id={`${id}-${i}-label`}
            label="Shown As"
            value={o.label}
            onChange={(e) => set({ ...o, label: e.target.value })}
          />
        </div>
      )}
    </ListRows>
  </FieldSet>
);

const EntryFields = ({
  id,
  path,
  entries,
  value,
  editable,
  errors,
  onChange
}: Omit<ShapeFieldProps, 'label' | 'shape' | 'entry' | 'onChange'> & {
  entries: readonly FormEntry[];
  onChange: (value: Json) => void;
}) => {
  const record = recordOf(value);
  return entries.map((entry) => (
    <ShapeField
      key={entry.name}
      id={`${id}-${entry.name}`}
      path={path ? `${path}.${entry.name}` : entry.name}
      label={labelFromName(entry.name)}
      shape={entry.shape}
      value={record[entry.name]}
      entry={entry}
      editable={editable}
      errors={errors}
      onChange={(next) => onChange(withEntry(record, entry.name, next))}
    />
  ));
};

const ShapeField = (props: ShapeFieldProps) => {
  const { id, path, label, shape, value, entry, editable, errors, onChange } = props;
  const isOptional = entry?.isOptional ?? false;
  const fallback = entry?.fallback;
  const shown = value ?? fallback;
  const error = errors[path]?.[0];
  const unsetWhen = (next: Json, blank: boolean) =>
    isOptional && (blank || next === fallback) ? undefined : next;
  switch (shape.kind) {
    case 'text':
      return (
        <Input
          id={id}
          label={label}
          error={error}
          required={!isOptional}
          value={typeof shown === 'string' ? shown : ''}
          onChange={(e) => onChange(unsetWhen(e.target.value, e.target.value === ''))}
        />
      );
    case 'number':
      return (
        <Input
          id={id}
          label={label}
          error={error}
          type="number"
          required={!isOptional}
          inputMode={shape.isInteger ? 'numeric' : 'decimal'}
          step={shape.isInteger ? 1 : 'any'}
          min={shape.min}
          max={shape.max}
          value={typeof shown === 'number' ? shown : ''}
          onChange={(e) =>
            onChange(e.target.value === '' ? undefined : unsetWhen(Number(e.target.value), false))
          }
        />
      );
    case 'boolean':
      return (
        <label htmlFor={id} className="flex cursor-pointer items-center gap-2 text-sm font-medium">
          <Checkbox
            id={id}
            checked={shown === true}
            onChange={(e) => onChange(unsetWhen(e.target.checked, false))}
          />
          {label}
        </label>
      );
    case 'choice':
      return (
        <Select
          id={id}
          label={label}
          error={error}
          options={[
            ...(isOptional && fallback === undefined ? [{ value: '', label: 'Not Set' }] : []),
            ...shape.options.map((o) => ({ value: o, label: choiceLabel(o) }))
          ]}
          value={typeof shown === 'string' ? shown : ''}
          onChange={(next) => onChange(unsetWhen(next, next === ''))}
        />
      );
    case 'type':
      return (
        <TypePicker
          id={id}
          label={label}
          value={asValueType(shown)}
          editable={editable}
          onChange={(next) => onChange(unsetWhen(next, false))}
        />
      );
    case 'value':
      return (
        <ValueField
          id={id}
          label={label}
          type="any"
          error={error}
          value={shown ?? null}
          editable={editable}
          onChange={(next) => onChange(unsetWhen(next, next === null))}
        />
      );
    case 'options':
      return <ChoicesField {...props} />;
    case 'list': {
      const noun = singular(label);
      return (
        <FieldSet label={label}>
          {error ? <p className="text-danger text-sm">{error}</p> : null}
          <ListRows<Json>
            id={id}
            noun={noun}
            items={Array.isArray(shown) ? shown : []}
            editable={editable}
            blank={() => blankOf(shape.item)}
            onChange={(items) => onChange(items)}
          >
            {(item, i, set) => (
              <ShapeField
                id={`${id}-${i}`}
                path={`${path}.${i}`}
                label={`${noun} ${i + 1}`}
                shape={shape.item}
                value={item}
                editable={editable}
                errors={errors}
                onChange={(next) => set(next ?? null)}
              />
            )}
          </ListRows>
        </FieldSet>
      );
    }
    case 'object':
      return (
        <FieldSet label={label}>
          <EntryFields
            id={id}
            path={path}
            entries={shape.entries}
            value={shown}
            editable={editable}
            errors={errors}
            onChange={onChange}
          />
        </FieldSet>
      );
    default:
      return (
        <JsonField
          id={id}
          label={label}
          error={error}
          value={shown ?? null}
          onChange={(next) => onChange(next ?? undefined)}
        />
      );
  }
};

export const errorsOf = (
  schema: v.GenericSchema,
  config: Json | undefined
): { root: readonly string[]; nested: Errors } => {
  const result = v.safeParse(schema, config ?? {});
  if (result.success) return { root: [], nested: {} };
  const flat = v.flatten(result.issues);
  return { root: flat.root ?? [], nested: flat.nested ?? {} };
};

type ConfigFormProps = {
  id: string;
  schema: v.GenericSchema;
  config: Json | undefined;
  editable: boolean;
  onConfig: (config: Json | undefined) => void;
};

export const ConfigForm = ({ id, schema, config, editable, onConfig }: ConfigFormProps) => {
  const shape = shapeOf(schema);
  const { root, nested } = errorsOf(schema, config);
  return (
    <fieldset disabled={!editable} className="flex min-w-0 flex-col gap-5">
      {root.map((message) => (
        <p key={message} role="alert" className="text-danger text-sm">
          {message}
        </p>
      ))}
      {shape.kind === 'object' ? (
        <EntryFields
          id={id}
          path=""
          entries={shape.entries}
          value={config}
          editable={editable}
          errors={nested}
          onChange={onConfig}
        />
      ) : (
        <ShapeField
          id={id}
          path=""
          label="Settings"
          shape={shape}
          value={config}
          editable={editable}
          errors={nested}
          onChange={onConfig}
        />
      )}
    </fieldset>
  );
};
