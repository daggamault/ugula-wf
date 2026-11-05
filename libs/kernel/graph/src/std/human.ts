import * as v from 'valibot';
import { defineNode, next, pin, suspend } from '../define.ts';
import { fail } from '../errors.ts';
import { checkField } from '../fields.ts';
import { isRecord } from '../json.ts';
import { type FieldSpec, fieldsSchema, optionsSchema } from '../schemas.ts';
import type { Json } from '../types.ts';

const outcomeName = v.pipe(v.string(), v.regex(/^[A-Za-z_$][\w$]*$/));

export const TASK_PREFILLS = ['current', 'suggested'] as const;

const taskConfigOf = (permissions: readonly string[] | undefined) =>
  v.pipe(
    v.object({
      title: v.pipe(v.string(), v.nonEmpty()),
      queue: v.pipe(v.string(), v.nonEmpty()),
      instructions: v.optional(v.string(), ''),
      permission: v.optional(
        v.pipe(
          v.string(),
          v.regex(/^[a-z_]+:[a-z]+$/),
          v.check((p) => !permissions || permissions.includes(p), 'Unknown permission')
        )
      ),
      fields: v.optional(fieldsSchema, []),
      outcomes: v.pipe(
        v.array(outcomeName),
        v.minLength(1),
        v.check((xs) => new Set(xs).size === xs.length, 'Outcomes must be unique')
      ),
      hints: v.optional(v.record(outcomeName, v.pipe(v.string(), v.nonEmpty())), {}),
      prefill: v.optional(v.picklist(TASK_PREFILLS))
    }),
    v.check(
      (c) => Object.keys(c.hints).every((k) => c.outcomes.includes(k)),
      'Hints must name outcomes of the task'
    )
  );

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

const shown = (fields: FieldSpec[], visible: Json) =>
  Array.isArray(visible) ? fields.filter((f) => visible.includes(f.name)) : fields;

export const createHumanTaskNode = (permissions?: readonly string[]) =>
  defineNode<v.InferOutput<ReturnType<typeof taskConfigOf>>>({
    type: 'std.human.task',
    version: 1,
    title: 'Human Task',
    category: 'Human',
    description:
      'Pauses the run and queues a task for a person, continuing through the outcome they choose. Hints say in one line what each outcome does, shown under its button. Prefill says what Defaults hold: current values (edits show as current → new) or suggestions. Summary says in one line what this task is about and what it needs. Visible limits the task to some of its fields; the others output nothing. Due is when the task must be done by; Permission names the permission whoever completes it needs.',
    config: taskConfigOf(permissions),
    signature: ({ fields, outcomes }) => ({
      execIn: ['exec'],
      execOut: outcomes,
      inputs: [
        pin('subject', 'string', { optional: true }),
        pin('summary', 'string', { optional: true }),
        pin('context', 'any', { optional: true }),
        pin('defaults', { object: {} }, { optional: true }),
        pin('options', { object: {} }, { optional: true }),
        pin('visible', { list: 'string' }, { optional: true }),
        pin('assignee', 'string', { optional: true }),
        pin('priority', 'integer', { default: 0 }),
        pin('due', 'datetime', { optional: true })
      ],
      outputs: [
        ...fields.map((f) => pin(f.name, f.type, f.label ? { label: f.label } : {})),
        pin('completedBy', 'string')
      ]
    }),
    run: async ({ event, read, config, state }) => {
      if (event.type !== 'resume') {
        const fields = shown(
          withOptions(config.fields, await read('options')),
          await read('visible')
        );
        return suspend(
          {
            kind: 'task',
            data: {
              title: config.title,
              queue: config.queue,
              instructions: config.instructions,
              fields,
              outcomes: config.outcomes,
              hints: config.hints,
              prefill: config.prefill ?? null,
              subject: await read('subject'),
              summary: await read('summary'),
              context: await read('context'),
              defaults: await read('defaults'),
              assignee: await read('assignee'),
              priority: await read('priority'),
              due: await read('due'),
              permission: config.permission ?? null
            }
          },
          fields
        );
      }
      const asked = (state as FieldSpec[] | null) ?? config.fields;
      const p = isRecord(event.payload) ? event.payload : {};
      const outcome = typeof p.outcome === 'string' ? p.outcome : '';
      if (!config.outcomes.includes(outcome)) fail(`Unknown task outcome "${outcome}"`);
      const values = isRecord(p.values) ? p.values : {};
      const outputs = Object.fromEntries(
        config.fields.map(({ name }) => {
          const f = asked.find((x) => x.name === name);
          const value = f && Object.hasOwn(values, name) ? (values[name] ?? null) : null;
          const err = f ? checkField(f, value, outcome) : null;
          return err ? fail(`Task field "${name}": ${err}`) : [name, value];
        })
      );
      return next(outcome, {
        ...outputs,
        completedBy: typeof p.userId === 'string' ? p.userId : null
      });
    }
  });
