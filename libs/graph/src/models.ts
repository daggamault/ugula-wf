import { pin, pureNode } from './define.ts';
import { isRecord } from './json.ts';
import type { NodeDef, PinSpec, ValueType } from './types.ts';

export type ModelField = { name: string; type: ValueType; label: string };

export type Model = {
  key: string;
  name: string;
  title: string;
  category: string;
  description: string;
  fields: readonly ModelField[];
};

export const modelType = (m: Pick<Model, 'fields'>): ValueType => ({
  object: Object.fromEntries(m.fields.map((f) => [f.name, f.type]))
});

const fieldPins = (m: Model): PinSpec[] =>
  m.fields.map((f) => pin(f.name, f.type, { label: f.label, optional: true }));

export const createModelNodes = (models: readonly Model[]): NodeDef[] =>
  models.flatMap((m) => [
    pureNode({
      type: `${m.key}.break`,
      title: `Break ${m.title}`,
      category: m.category,
      description: `Splits ${m.description} into one output per field.`,
      inputs: [pin(m.name, modelType(m), { label: m.title })],
      outputs: fieldPins(m),
      compute: (inputs) => {
        const value = inputs[m.name];
        const o = isRecord(value) ? value : {};
        return Object.fromEntries(m.fields.map((f) => [f.name, o[f.name] ?? null]));
      }
    }),
    pureNode({
      type: `${m.key}.make`,
      title: `Make ${m.title}`,
      category: m.category,
      description: `Builds ${m.description} from one input per field.`,
      inputs: fieldPins(m),
      outputs: [pin(m.name, modelType(m), { label: m.title })],
      compute: (inputs) => ({
        [m.name]: Object.fromEntries(m.fields.map((f) => [f.name, inputs[f.name] ?? null]))
      })
    })
  ]);
