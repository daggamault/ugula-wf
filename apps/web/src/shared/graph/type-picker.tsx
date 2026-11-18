import { SCALAR_TYPES, type ValueKinds, type ValueType } from '@ugula/graph';
import { useContext, useId } from 'react';
import { Checkbox } from '../ui/checkbox.tsx';
import { Input } from '../ui/input.tsx';
import { ListRows } from '../ui/list-rows.tsx';
import { Select, type SelectOption } from '../ui/select.tsx';
import { describeType, TYPE_WORDS, ValueKindsContext } from './pins.ts';

const CUSTOM_RECORD = 'record';

const NESTED = 'nested';

const isList = (type: ValueType): type is { list: ValueType } =>
  typeof type === 'object' && 'list' in type;

const isCustomRecord = (type: ValueType): type is { object: Record<string, ValueType> } =>
  typeof type === 'object' && 'object' in type && !type.model;

export const optionValue = (type: ValueType): string => {
  if (typeof type === 'string') return type;
  if ('id' in type) return `id:${type.id}`;
  if ('code' in type) return `code:${type.code}`;
  if ('list' in type) return NESTED;
  return type.model ? `model:${type.model}` : CUSTOM_RECORD;
};

export const typeOfOption = (value: string, kinds: ValueKinds): ValueType | null => {
  const [prefix, key = ''] = value.split(/:(.*)/s);
  if (prefix === 'id') return { id: key };
  if (prefix === 'code') return { code: key };
  if (prefix === 'model') {
    const model = kinds.models?.[key];
    return model
      ? { object: Object.fromEntries(model.fields.map((f) => [f.name, f.type])), model: key }
      : null;
  }
  if (value === CUSTOM_RECORD) return { object: {} };
  return SCALAR_TYPES.find((s) => s === value) ?? null;
};

const byLabel = (a: SelectOption, b: SelectOption) => a.label.localeCompare(b.label);

const kindGroup = (
  labels: Readonly<Record<string, string>>,
  prefix: string,
  group: string
): SelectOption[] =>
  Object.entries(labels)
    .map(([key, label]) => ({ value: `${prefix}:${key}`, label, group }))
    .sort(byLabel);

export const typeOptions = (
  kinds: ValueKinds,
  isFieldType: boolean,
  current: ValueType
): SelectOption[] => {
  const options = [
    ...SCALAR_TYPES.filter((s) => !(isFieldType && s === 'any')).map((s) => ({
      value: s,
      label: TYPE_WORDS[s],
      group: 'Basics'
    })),
    ...Object.values(kinds.models ?? {})
      .map((m) => ({ value: `model:${m.key}`, label: m.title, group: 'Records' }))
      .sort(byLabel),
    ...kindGroup(kinds.id, 'id', 'IDs'),
    ...kindGroup(kinds.code, 'code', 'Codes'),
    { value: CUSTOM_RECORD, label: 'Custom Record', group: 'Advanced' }
  ];
  const value = optionValue(current);
  return options.some((o) => o.value === value)
    ? options
    : [...options, { value, label: describeType(current, kinds), group: 'Advanced' }];
};

export const kindOptions = (labels: Readonly<Record<string, string>>, current: string) =>
  [
    ...Object.entries(labels).map(([value, label]) => ({ value, label })),
    ...(Object.hasOwn(labels, current) ? [] : [{ value: current, label: current }])
  ].sort((a, b) => a.label.localeCompare(b.label));

export const freeFieldName = (taken: readonly string[]) => {
  let n = taken.length + 1;
  while (taken.includes(`field${n}`)) n++;
  return `field${n}`;
};

type TypePickerProps = {
  id: string;
  label: string;
  value: ValueType;
  editable?: boolean | undefined;
  isFieldType?: boolean | undefined;
  onChange: (type: ValueType) => void;
};

const RecordFields = ({
  id,
  value,
  editable,
  isFieldType,
  onChange
}: {
  id: string;
  value: { object: Record<string, ValueType> };
  editable: boolean;
  isFieldType: boolean;
  onChange: (type: ValueType) => void;
}) => (
  <div className="border-border flex flex-col gap-3 border-l-2 pl-4">
    <ListRows
      id={`${id}-fields`}
      noun="Field"
      items={Object.entries(value.object)}
      editable={editable}
      blank={(): [string, ValueType] => [freeFieldName(Object.keys(value.object)), 'string']}
      nameOf={([name]) => name}
      onChange={(fields) => onChange({ object: Object.fromEntries(fields) })}
    >
      {([name, type], i, set) => (
        <>
          <Input
            id={`${id}-field-${i}`}
            label="Field Name"
            isMonospace
            value={name}
            onChange={(e) => set([e.target.value, type])}
          />
          <TypePicker
            id={`${id}-field-${i}-type`}
            label="Type"
            value={type}
            editable={editable}
            isFieldType={isFieldType}
            onChange={(t) => set([name, t])}
          />
        </>
      )}
    </ListRows>
  </div>
);

export const TypePicker = ({
  id,
  label,
  value,
  editable = true,
  isFieldType = false,
  onChange
}: TypePickerProps) => {
  const kinds = useContext(ValueKindsContext);
  const listId = useId();
  const listed = isList(value);
  const base = listed ? value.list : value;
  const wrap = (type: ValueType): ValueType => (listed ? { list: type } : type);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 items-end gap-3">
        <div className="min-w-0 flex-1">
          <Select
            id={id}
            label={label}
            options={typeOptions(kinds, isFieldType, base)}
            value={optionValue(base)}
            isSearchable
            disabled={!editable}
            onChange={(next) => {
              const type = typeOfOption(next, kinds);
              if (type) onChange(wrap(type));
            }}
          />
        </div>
        <label
          htmlFor={listId}
          title="Many of these, in order"
          className="flex h-10 shrink-0 cursor-pointer items-center gap-2 text-sm font-medium pointer-coarse:h-11"
        >
          <Checkbox
            id={listId}
            checked={listed}
            disabled={!editable}
            onChange={(e) => onChange(e.target.checked ? { list: value } : base)}
          />
          List
        </label>
      </div>
      {isCustomRecord(base) ? (
        <RecordFields
          id={id}
          value={base}
          editable={editable}
          isFieldType={isFieldType}
          onChange={(type) => onChange(wrap(type))}
        />
      ) : null}
    </div>
  );
};
