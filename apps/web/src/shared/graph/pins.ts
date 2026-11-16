import type { ValueKinds, ValueType } from '@ugula/graph';
import { createContext } from 'react';
import { labelFromName, titleCaseLabel } from '../format.ts';

type PinKind =
  | 'exec'
  | 'any'
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'datetime'
  | 'list'
  | 'object';

type PinTone = {
  dot: string;
  edge: string;
};

export const pinKindOf = (type: ValueType | 'exec'): PinKind =>
  typeof type === 'string'
    ? type
    : 'id' in type || 'code' in type
      ? 'string'
      : 'list' in type
        ? 'list'
        : 'object';

const pinTones: Record<PinKind, PinTone> = {
  exec: {
    dot: 'bg-surface-fg-muted',
    edge: '[&_.react-flow__edge-path]:stroke-surface-fg-muted [&_.react-flow__edge-path]:stroke-[3]'
  },
  any: {
    dot: 'bg-surface-fg-muted/60',
    edge: '[&_.react-flow__edge-path]:stroke-surface-fg-muted/60'
  },
  string: { dot: 'bg-pin-string', edge: '[&_.react-flow__edge-path]:stroke-pin-string' },
  number: { dot: 'bg-pin-number', edge: '[&_.react-flow__edge-path]:stroke-pin-number' },
  integer: { dot: 'bg-pin-integer', edge: '[&_.react-flow__edge-path]:stroke-pin-integer' },
  boolean: { dot: 'bg-pin-boolean', edge: '[&_.react-flow__edge-path]:stroke-pin-boolean' },
  datetime: { dot: 'bg-pin-datetime', edge: '[&_.react-flow__edge-path]:stroke-pin-datetime' },
  list: { dot: 'bg-pin-list', edge: '[&_.react-flow__edge-path]:stroke-pin-list' },
  object: { dot: 'bg-pin-object', edge: '[&_.react-flow__edge-path]:stroke-pin-object' }
};

export const toneOf = (type: ValueType | 'exec') => pinTones[pinKindOf(type)];

export const TYPE_WORDS: Readonly<Record<Exclude<PinKind, 'list' | 'object' | 'exec'>, string>> = {
  any: 'Any Value',
  string: 'Text',
  number: 'Number',
  integer: 'Whole Number',
  boolean: 'Yes or No',
  datetime: 'Date and Time'
};

export const ValueKindsContext = createContext<ValueKinds>({ id: {}, code: {} });

export const describeType = (type: ValueType, kinds: ValueKinds): string => {
  if (typeof type === 'string') return TYPE_WORDS[type];
  if ('id' in type) return kinds.id[type.id] ?? `${labelFromName(type.id)} ID`;
  if ('code' in type) return kinds.code[type.code] ?? `${labelFromName(type.code)} Code`;
  if ('list' in type) return `List of ${describeType(type.list, kinds)}`;
  const fields = Object.keys(type.object);
  return fields.length ? `Record With ${fields.join(', ')}` : 'Record';
};

export const pinLabel = (spec: { name: string; label?: string | undefined }) =>
  spec.label ? titleCaseLabel(spec.label) : labelFromName(spec.name);
