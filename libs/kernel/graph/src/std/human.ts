import * as v from 'valibot';
import { defineNode, next, pin, suspend } from '../define.ts';
import { fail } from '../errors.ts';
import { checkField } from '../fields.ts';
import { isRecord } from '../json.ts';
import { type FieldSpec, fieldsSchema, optionsSchema } from '../schemas.ts';
import type { Json, NodeDef } from '../types.ts';

const taskConfig = v.object({
  title: v.pipe(v.string(), v.nonEmpty()),
  queue: v.pipe(v.string(), v.nonEmpty()),
  instructions: v.optional(v.string(), ''),
  fields: v.optional(fieldsSchema, []),
  outcomes: v.pipe(
    v.array(v.pipe(v.string(), v.regex(/^[A-Za-z_$][\w$]*$/))),
    v.minLength(1),
    v.check((xs) => new Set(xs).size === xs.length, 'Outcomes must be unique')
  )
});

const fieldOptionsSchema = v.record(v.string(), optionsSchema);

const withOptions = (fields: FieldSpec[], options: Json) => {
  if (options === null) return fields;
  const parsed = v.safeParse(fieldOptionsSchema, options);
  if (!parsed.success) return fail(`Task options: ${v.summarize(parsed.issues)}`);
  const unknown = Object.keys(parsed.output).find((k) => !fields.some((f) => f.name === k));
  if (unknown) return fail(`Task options name unknown field "${unknown}"`);
  return fields.map((f) => {
    const choices = parsed.output[f.name];
    return choices ? { ...f, options: choices } : f;
  });
};

export const humanTaskNode = defineNode<v.InferOutput<typeof taskConfig>>({
  type: 'std.human.task',
  version: 1,
  title: 'Human Task',
  category: 'Human',
  description:
    'Pauses the run and queues a task for a person, continuing through the outcome they choose.',
  config: taskConfig,
  signature: ({ fields, outcomes }) => ({
    execIn: ['exec'],
    execOut: outcomes,
    inputs: [
      pin('subject', 'string', { optional: true }),
      pin('context', 'any', { optional: true }),
      pin('defaults', { object: {} }, { optional: true }),
      pin('options', { object: {} }, { optional: true }),
      pin('assignee', 'string', { optional: true }),
      pin('priority', 'integer', { default: 0 })
    ],
    outputs: [
      ...fields.map((f) => pin(f.name, f.type, f.label ? { label: f.label } : {})),
      pin('completedBy', 'string')
    ]
  }),
  run: async ({ event, read, config, state }) => {
    if (event.type !== 'resume') {
      const fields = withOptions(config.fields, await read('options'));
      return suspend(
        {
          kind: 'task',
          data: {
            title: config.title,
            queue: config.queue,
            instructions: config.instructions,
            fields,
            outcomes: config.outcomes,
            subject: await read('subject'),
            context: await read('context'),
            defaults: await read('defaults'),
            assignee: await read('assignee'),
            priority: await read('priority')
          }
        },
        fields
      );
    }
    const fields = (state as FieldSpec[] | null) ?? config.fields;
    const p = isRecord(event.payload) ? event.payload : {};
    const outcome = typeof p.outcome === 'string' ? p.outcome : '';
    if (!config.outcomes.includes(outcome)) fail(`Unknown task outcome "${outcome}"`);
    const values = isRecord(p.values) ? p.values : {};
    const outputs = Object.fromEntries(
      fields.map((f) => {
        const value = Object.hasOwn(values, f.name) ? (values[f.name] ?? null) : null;
        const err = checkField(f, value);
        return err ? fail(`Task field "${f.name}": ${err}`) : [f.name, value];
      })
    );
    return next(outcome, {
      ...outputs,
      completedBy: typeof p.userId === 'string' ? p.userId : null
    });
  }
});

export const humanNodes: NodeDef[] = [humanTaskNode];
