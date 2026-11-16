import {
  isRecord,
  type Json,
  jsonSchema,
  optionsSchema,
  type ValueType,
  valueTypeSchema
} from '@ugula/graph';
import * as v from 'valibot';

export type FormShape =
  | { kind: 'text' }
  | { kind: 'number'; isInteger: boolean; min?: number; max?: number }
  | { kind: 'boolean' }
  | { kind: 'choice'; options: readonly string[] }
  | { kind: 'type' }
  | { kind: 'value' }
  | { kind: 'options' }
  | { kind: 'list'; item: FormShape }
  | { kind: 'object'; entries: FormEntry[] }
  | { kind: 'json' };

export type FormEntry = {
  name: string;
  shape: FormShape;
  isOptional: boolean;
  fallback: Json | undefined;
};

type Node = {
  type: string;
  entries?: Record<string, Node>;
  item?: Node;
  options?: readonly unknown[];
  wrapped?: Node;
  literal?: unknown;
  pipe?: readonly Action[];
};

type Action = { type: string; requirement?: unknown; pipe?: readonly Action[] };

const OBJECTS = new Set(['object', 'strict_object', 'loose_object']);
const OPTIONALS = new Set(['optional', 'exact_optional', 'nullish', 'undefinedable']);

const asNode = (schema: unknown) => schema as Node;

const actionsOf = (node: Action): Action[] =>
  (node.pipe ?? []).flatMap((a, i) => (i === 0 ? actionsOf(a) : [a]));

const requirementOf = (node: Node, action: string) => {
  const found = actionsOf(node).find((a) => a.type === action)?.requirement;
  return typeof found === 'number' ? found : undefined;
};

const literalsOf = (node: Node) => {
  const values =
    node.type === 'picklist'
      ? (node.options ?? [])
      : (node.options ?? []).map((o) => (asNode(o).type === 'literal' ? asNode(o).literal : null));
  return values.every((x) => typeof x === 'string') ? values : null;
};

export const shapeOf = (schema: unknown): FormShape => {
  if (schema === valueTypeSchema) return { kind: 'type' };
  if (schema === jsonSchema) return { kind: 'value' };
  if (schema === optionsSchema) return { kind: 'options' };
  const node = asNode(schema);
  if (OPTIONALS.has(node.type) && node.wrapped) return shapeOf(node.wrapped);
  if (node.type === 'string') return { kind: 'text' };
  if (node.type === 'boolean') return { kind: 'boolean' };
  if (node.type === 'number') {
    const min = requirementOf(node, 'min_value');
    const max = requirementOf(node, 'max_value');
    return {
      kind: 'number',
      isInteger: actionsOf(node).some((a) => a.type === 'integer'),
      ...(min === undefined ? {} : { min }),
      ...(max === undefined ? {} : { max })
    };
  }
  if (node.type === 'picklist' || node.type === 'union') {
    const options = literalsOf(node);
    return options ? { kind: 'choice', options } : { kind: 'json' };
  }
  if (node.type === 'array' && node.item) return { kind: 'list', item: shapeOf(node.item) };
  if (OBJECTS.has(node.type) && node.entries) {
    return {
      kind: 'object',
      entries: Object.entries(node.entries).map(([name, entry]) => ({
        name,
        shape: shapeOf(entry),
        isOptional: OPTIONALS.has(entry.type),
        fallback: OPTIONALS.has(entry.type)
          ? (v.getDefault(entry as v.GenericSchema) as Json | undefined)
          : undefined
      }))
    };
  }
  return { kind: 'json' };
};

export const blankOf = (shape: FormShape): Json => {
  switch (shape.kind) {
    case 'text':
      return '';
    case 'number':
      return shape.min ?? 0;
    case 'boolean':
      return false;
    case 'choice':
      return shape.options[0] ?? '';
    case 'type':
      return 'string';
    case 'list':
    case 'options':
      return [];
    case 'object':
      return Object.fromEntries(
        shape.entries.filter((e) => !e.isOptional).map((e) => [e.name, blankOf(e.shape)])
      );
    default:
      return null;
  }
};

export const singular = (label: string) =>
  label.endsWith('s') && !label.endsWith('ss') ? label.slice(0, -1) : label;

export const recordOf = (config: Json | undefined): Record<string, Json> =>
  isRecord(config) ? config : {};

export const withEntry = (
  record: Readonly<Record<string, Json>>,
  name: string,
  value: Json | undefined
): Record<string, Json> => {
  const { [name]: _, ...rest } = record;
  return value === undefined ? rest : { ...rest, [name]: value };
};

export const asValueType = (value: Json | undefined): ValueType =>
  typeof value === 'string' || isRecord(value) ? (value as ValueType) : 'any';
