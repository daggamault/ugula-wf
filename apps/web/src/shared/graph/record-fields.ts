import { isRecord, type Model, type NodeInstance, type ValueType } from '@ugula/graph';
import { labelFromName } from '../format.ts';

export type Models = Readonly<Record<string, Model>>;

export const NO_MODELS: Models = {};

export const GET_FIELD = { type: 'std.object.get-field', version: 1 } as const;

export const SET_FIELD = { type: 'std.object.set-field', version: 1 } as const;

const FIELD_NODES = new Set<string>([GET_FIELD.type, SET_FIELD.type]);

export const FOR_EACH_TYPE = 'std.flow.for-each';

export const modelOf = (type: ValueType, models: Models): Model | null =>
  typeof type === 'object' && 'object' in type && type.model ? (models[type.model] ?? null) : null;

type Field = { name: string; type: ValueType; label: string; description: string };

export const fieldsOf = (type: ValueType, models: Models): Field[] => {
  if (typeof type !== 'object' || !('object' in type)) return [];
  const model = modelOf(type, models);
  if (model) return model.fields.filter((f) => Object.hasOwn(type.object, f.name));
  return Object.entries(type.object).map(([name, t]) => ({
    name,
    type: t,
    label: labelFromName(name),
    description: ''
  }));
};

const fieldAt = (type: ValueType, path: string, models: Models) => {
  const steps: Field[] = [];
  let cur: ValueType = type;
  for (const key of path.split('.')) {
    const field = fieldsOf(cur, models).find((f) => f.name === key);
    if (!field) return null;
    steps.push(field);
    cur = field.type;
  }
  return steps.length ? steps : null;
};

const fieldConfigOf = (inst: NodeInstance) => {
  if (!FIELD_NODES.has(inst.type) || !isRecord(inst.config)) return null;
  const { record, path } = inst.config;
  return typeof path === 'string' && path && record !== undefined
    ? { record: record as ValueType, path }
    : null;
};

type FieldNodeInfo = { label: string; description: string; from: string | null };

export const fieldNodeInfo = (inst: NodeInstance, models: Models): FieldNodeInfo | null => {
  const config = fieldConfigOf(inst);
  const steps = config && fieldAt(config.record, config.path, models);
  if (!config || !steps) return null;
  const last = steps.at(-1);
  return {
    label: steps.map((s) => s.label).join(' › '),
    description: last?.description ?? '',
    from: modelOf(config.record, models)?.title ?? null
  };
};

export const fieldEntries = (type: ValueType, models: Models) => {
  const owner = modelOf(type, models)?.title ?? 'Record';
  return fieldsOf(type, models).map((f) => ({
    ...GET_FIELD,
    title: f.label,
    category: `${owner} Fields`,
    description: f.description || `The ${f.label} of the ${owner}.`,
    level: 'basic' as const,
    keywords: [f.name, owner.toLowerCase(), 'field'],
    config: { record: type, path: f.name }
  }));
};
