import type { ValueType } from '@ugula/graph';

export type PinKind =
  | 'exec'
  | 'any'
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'datetime'
  | 'list'
  | 'object';

export type PinTone = {
  dot: string;
  edge: string;
};

export const pinKindOf = (type: ValueType | 'exec'): PinKind =>
  typeof type === 'string' ? type : 'list' in type ? 'list' : 'object';

export const pinTones: Record<PinKind, PinTone> = {
  exec: {
    dot: 'bg-surface-fg-muted',
    edge: '[&_.react-flow__edge-path]:stroke-surface-fg-muted [&_.react-flow__edge-path]:stroke-[3]'
  },
  any: {
    dot: 'bg-surface-fg-muted/60',
    edge: '[&_.react-flow__edge-path]:stroke-surface-fg-muted/60'
  },
  string: { dot: 'bg-pink-500', edge: '[&_.react-flow__edge-path]:stroke-pink-500' },
  number: { dot: 'bg-emerald-500', edge: '[&_.react-flow__edge-path]:stroke-emerald-500' },
  integer: { dot: 'bg-teal-500', edge: '[&_.react-flow__edge-path]:stroke-teal-500' },
  boolean: { dot: 'bg-rose-600', edge: '[&_.react-flow__edge-path]:stroke-rose-600' },
  datetime: { dot: 'bg-amber-500', edge: '[&_.react-flow__edge-path]:stroke-amber-500' },
  list: { dot: 'bg-sky-500', edge: '[&_.react-flow__edge-path]:stroke-sky-500' },
  object: { dot: 'bg-violet-500', edge: '[&_.react-flow__edge-path]:stroke-violet-500' }
};

export const toneOf = (type: ValueType | 'exec') => pinTones[pinKindOf(type)];
