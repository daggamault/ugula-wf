import * as v from 'valibot';
import type { GraphDef, Json, PinSpec, Signature, Values, ValueType } from './types.ts';

const unreserved = v.check((s: string) => !(s in Object.prototype), 'This name is reserved');
const name = v.pipe(
  v.string(),
  v.regex(/^[A-Za-z_$][\w$]*$/, 'Names must be identifiers'),
  unreserved
);
const id = v.pipe(v.string(), v.nonEmpty(), v.maxLength(64), unreserved);
const positiveInt = v.pipe(v.number(), v.integer(), v.minValue(1));

const MAX_RETRIES = 100;

export const MAX_RETRY_DELAY_MS = 30 * 86_400_000;

export const jsonSchema: v.GenericSchema<Json> = v.lazy(() =>
  v.union([
    v.null(),
    v.boolean(),
    v.pipe(v.number(), v.finite()),
    v.string(),
    v.array(jsonSchema),
    v.record(v.string(), jsonSchema)
  ])
);

export const valuesSchema: v.GenericSchema<Values> = v.record(v.string(), jsonSchema);

export const valueTypeSchema: v.GenericSchema<ValueType> = v.lazy(() =>
  v.union([
    v.picklist(['any', 'string', 'number', 'integer', 'boolean', 'datetime']),
    v.strictObject({ list: valueTypeSchema }),
    v.strictObject({ object: v.record(name, valueTypeSchema) })
  ])
);

const pinSpecSchema: v.GenericSchema<PinSpec> = v.strictObject({
  name,
  type: valueTypeSchema,
  label: v.exactOptional(v.string()),
  optional: v.exactOptional(v.boolean()),
  default: v.exactOptional(jsonSchema)
});

const signatureSchema: v.GenericSchema<Signature> = v.strictObject({
  execIn: v.array(name),
  execOut: v.array(name),
  inputs: v.array(pinSpecSchema),
  outputs: v.array(pinSpecSchema)
});

export const graphDefSchema: v.GenericSchema<GraphDef> = v.strictObject({
  signature: signatureSchema,
  variables: v.array(v.strictObject({ name, type: valueTypeSchema, default: jsonSchema })),
  nodes: v.array(
    v.strictObject({
      id,
      type: v.pipe(v.string(), v.nonEmpty()),
      version: positiveInt,
      label: v.exactOptional(v.string()),
      config: v.exactOptional(jsonSchema),
      inputs: v.exactOptional(
        v.record(
          v.string(),
          v.union([v.strictObject({ value: jsonSchema }), v.strictObject({ expr: v.string() })])
        )
      ),
      retry: v.exactOptional(
        v.strictObject({
          max: v.pipe(positiveInt, v.maxValue(MAX_RETRIES)),
          delayMs: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(MAX_RETRY_DELAY_MS)),
          factor: v.exactOptional(v.pipe(v.number(), v.minValue(1), v.maxValue(10)))
        })
      ),
      position: v.exactOptional(v.strictObject({ x: v.number(), y: v.number() }))
    })
  ),
  edges: v.array(v.strictObject({ from: id, fromPin: name, to: id, toPin: name }))
});

export const optionsSchema = v.pipe(
  v.array(
    v.union([
      v.pipe(
        v.string(),
        v.transform((value) => ({ value, label: value }))
      ),
      v.strictObject({ value: v.string(), label: v.string() })
    ])
  ),
  v.minLength(1)
);

export const fieldsSchema = v.pipe(
  v.array(
    v.strictObject({
      name,
      type: valueTypeSchema,
      label: v.exactOptional(v.string()),
      options: v.exactOptional(optionsSchema),
      required: v.exactOptional(v.array(name)),
      format: v.exactOptional(v.picklist(['date'])),
      min: v.exactOptional(v.number()),
      max: v.exactOptional(v.number())
    })
  ),
  v.check((fs) => new Set(fs.map((f) => f.name)).size === fs.length, 'Field names must be unique')
);

export type FieldSpec = v.InferOutput<typeof fieldsSchema>[number];
