import type { ValueType } from '@ugula/graph';

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
  typeof type === 'string' ? type : 'list' in type ? 'list' : 'object';

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

const TYPE_WORDS: Readonly<Record<Exclude<PinKind, 'list' | 'object' | 'exec'>, string>> = {
  any: 'Any Value',
  string: 'Text',
  number: 'Number',
  integer: 'Whole Number',
  boolean: 'Yes or No',
  datetime: 'Date and Time'
};

export const describeType = (type: ValueType): string => {
  if (typeof type === 'string') return TYPE_WORDS[type];
  if ('list' in type) return `List of ${describeType(type.list)}`;
  const fields = Object.keys(type.object);
  return fields.length ? `Record With ${fields.join(', ')}` : 'Record';
};
