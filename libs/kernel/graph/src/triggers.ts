import * as v from 'valibot';
import { ENTRY_TYPE } from './compile.ts';
import { conditionSchema, holds } from './std/tables.ts';
import type { GraphDef, Json, PinSpec, Signature, Values } from './types.ts';
import { formatType, isAssignable } from './value-types.ts';

export type EventDef = {
  type: string;
  label: string;
  description: string;
  payload: PinSpec[];
};

export type WorkflowEvent = { type: string; payload: Values };

export const EVENT_TYPE_PATTERN = /^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/;

export const SCHEDULE_PERIODS = ['day', 'week', 'month'] as const;

export type SchedulePeriod = (typeof SCHEDULE_PERIODS)[number];

export const triggerSchema = v.variant('kind', [
  v.strictObject({ kind: v.literal('manual') }),
  v.strictObject({
    kind: v.literal('event'),
    event: v.pipe(v.string(), v.regex(EVENT_TYPE_PATTERN, 'Use a dotted lowercase event type')),
    where: v.optional(v.record(v.string(), conditionSchema), {})
  }),
  v.strictObject({
    kind: v.literal('schedule'),
    every: v.picklist(SCHEDULE_PERIODS),
    hour: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(23))
  })
]);

export type Trigger = v.InferOutput<typeof triggerSchema>;

export const MANUAL_TRIGGER: Trigger = { kind: 'manual' };

export const SUBWORKFLOW_TRIGGER =
  'Only a workflow starts on its own; a subworkflow runs when a graph calls it';

export const entryConfigSchema = v.object({
  trigger: v.optional(triggerSchema, MANUAL_TRIGGER)
});

export const entryTrigger = (config: Json | undefined): Trigger => {
  const parsed = v.safeParse(entryConfigSchema, config ?? {});
  return parsed.success ? parsed.output.trigger : MANUAL_TRIGGER;
};

export const triggerOf = (def: GraphDef): Trigger =>
  entryTrigger(def.nodes.find((n) => n.type === ENTRY_TYPE)?.config);

export const eventOf = (events: readonly EventDef[], type: string) =>
  events.find((e) => e.type === type);

export const triggerMatches = (trigger: Trigger, event: WorkflowEvent) =>
  trigger.kind === 'event' &&
  trigger.event === event.type &&
  Object.entries(trigger.where).every(([field, test]) =>
    holds(test, (event.payload[field] ?? null) as Json)
  );

export const triggerInputs = (signature: Signature, payload: Values): Values =>
  Object.fromEntries(
    signature.inputs
      .filter((p) => Object.hasOwn(payload, p.name))
      .map((p) => [p.name, payload[p.name] ?? null])
  );

const needsValue = (p: PinSpec) => !p.optional && p.default === undefined;

export const triggerIssues = (def: GraphDef, events: readonly EventDef[]): string[] => {
  const trigger = triggerOf(def);
  if (trigger.kind === 'manual') return [];
  if (!def.signature.execIn.length) return ['Only a graph with a way in can start on its own'];
  if (trigger.kind === 'schedule') {
    return def.signature.inputs
      .filter(needsValue)
      .map((p) => `A scheduled workflow gets no inputs, so give "${p.name}" a default`);
  }
  const event = eventOf(events, trigger.event);
  if (!event) return [`Unknown event ${trigger.event}`];
  const given = new Map(event.payload.map((p) => [p.name, p]));
  return [
    ...Object.keys(trigger.where)
      .filter((field) => !given.has(field))
      .map((field) => `${event.label} has no "${field}" to test`),
    ...def.signature.inputs.flatMap((input) => {
      const from = given.get(input.name);
      if (!from) {
        return needsValue(input)
          ? [`${event.label} gives no "${input.name}", so make it optional or give it a default`]
          : [];
      }
      return isAssignable(from.type, input.type)
        ? []
        : [
            `Input "${input.name}" is ${formatType(input.type)}, but ${event.label} gives ${formatType(from.type)}`
          ];
    })
  ];
};
