import { pin, pureNode } from './define.ts';
import { isRecord } from './json.ts';
import type { NodeDef, PinSpec, ValueType } from './types.ts';

export type ModelField = { name: string; type: ValueType; label: string; description: string };

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
  m.fields.map((f) =>
    pin(f.name, f.type, { label: f.label, optional: true, description: f.description })
  );

export const createModelNodes = (models: readonly Model[]): NodeDef[] =>
  models.flatMap((m) => [
    pureNode({
      type: `${m.key}.break`,
      title: `Break ${m.title}`,
      category: m.category,
      description: `Splits ${m.description} into its fields.`,
      level: 'basic',
      keywords: ['break', 'split', 'fields', m.title.toLowerCase()],
      inputs: [
        pin(m.name, modelType(m), {
          label: m.title,
          optional: true,
          description: `The ${m.title} to split.`
        })
      ],
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
      description: `Builds ${m.description} from its fields.`,
      level: 'basic',
      keywords: ['make', 'build', 'fields', m.title.toLowerCase()],
      inputs: fieldPins(m),
      outputs: [
        pin(m.name, modelType(m), { label: m.title, description: `The ${m.title} built.` })
      ],
      compute: (inputs) => ({
        [m.name]: Object.fromEntries(m.fields.map((f) => [f.name, inputs[f.name] ?? null]))
      })
    })
  ]);
