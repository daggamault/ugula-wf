import { SCALAR_TYPES, type ScalarType, type ValueKinds, type ValueType } from '@ugula/graph';
import { type ReactNode, useContext } from 'react';
import { Input } from '../ui/input.tsx';
import { ListRows } from '../ui/list-rows.tsx';
import { Select, type SelectOption } from '../ui/select.tsx';
import { TYPE_WORDS, ValueKindsContext } from './pins.ts';

type TypeShape = ScalarType | 'id' | 'code' | 'list' | 'object';

export const shapeOf = (type: ValueType): TypeShape =>
  typeof type === 'string'
    ? type
    : 'id' in type
      ? 'id'
      : 'code' in type
        ? 'code'
        : 'list' in type
          ? 'list'
          : 'object';

export const shapeOptions = (kinds: ValueKinds, isFieldType: boolean): SelectOption[] => [
  ...SCALAR_TYPES.filter((s) => !(isFieldType && s === 'any')).map((s) => ({
    value: s,
    label: TYPE_WORDS[s]
  })),
  ...(Object.keys(kinds.id).length ? [{ value: 'id', label: 'ID' }] : []),
  ...(Object.keys(kinds.code).length ? [{ value: 'code', label: 'Code' }] : []),
  { value: 'list', label: 'List' },
  { value: 'object', label: 'Record' }
];

export const typeFor = (shape: string, kinds: ValueKinds): ValueType => {
  if (shape === 'id') return { id: Object.keys(kinds.id)[0] ?? '' };
  if (shape === 'code') return { code: Object.keys(kinds.code)[0] ?? '' };
  if (shape === 'list') return { list: 'string' };
  if (shape === 'object') return { object: {} };
  return SCALAR_TYPES.find((s) => s === shape) ?? 'any';
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

const Nested = ({ children }: { children: ReactNode }) => (
  <div className="border-border flex flex-col gap-3 border-l-2 pl-4">{children}</div>
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
  const shape = shapeOf(value);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Select
        id={id}
        label={label}
        options={shapeOptions(kinds, isFieldType)}
        value={shape}
        onChange={(next) => onChange(typeFor(next, kinds))}
      />
      {typeof value === 'object' && 'id' in value ? (
        <Select
          id={`${id}-id`}
          label="ID Of"
          options={kindOptions(kinds.id, value.id)}
          value={value.id}
          onChange={(kind) => onChange({ id: kind })}
        />
      ) : null}
      {typeof value === 'object' && 'code' in value ? (
        <Select
          id={`${id}-code`}
          label="Code Set"
          options={kindOptions(kinds.code, value.code)}
          value={value.code}
          onChange={(kind) => onChange({ code: kind })}
        />
      ) : null}
      {typeof value === 'object' && 'list' in value ? (
        <Nested>
          <TypePicker
            id={`${id}-item`}
            label="Each Item Is"
            value={value.list}
            editable={editable}
            isFieldType={isFieldType}
            onChange={(item) => onChange({ list: item })}
          />
        </Nested>
      ) : null}
      {typeof value === 'object' && 'object' in value ? (
        <Nested>
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
        </Nested>
      ) : null}
    </div>
  );
};
