import {
  type ConditionOp,
  type EventDef,
  entryTrigger,
  hourLabel,
  type Json,
  SCHEDULE_PERIOD_LABELS,
  SCHEDULE_PERIODS,
  type SchedulePeriod,
  TRIGGER_KIND_LABELS,
  type Trigger
} from '@ugula/graph';
import { useContext } from 'react';
import { pinLabel, WorkflowEventsContext } from '../../shared/graph/pins.ts';
import { ListRows } from '../../shared/ui/list-rows.tsx';
import { Select } from '../../shared/ui/select.tsx';
import { recordOf } from './config-schema.ts';
import type { SettingsEditorProps } from './settings-editor.ts';
import { conditionValue, OPS, takesList, takesValue } from './table-config.ts';
import { CellInput, cellHint } from './table-editors.tsx';

type Condition = { op: ConditionOp; value?: Json };

type EventTest = Condition & { field: string };

const STARTS = Object.entries(TRIGGER_KIND_LABELS).map(([value, label]) => ({ value, label }));

const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: hourLabel(h) }));

const TEST_OPS = OPS.filter((o) => o.value !== '');

export const testsOf = (where: Readonly<Record<string, Condition>>): EventTest[] =>
  Object.entries(where).map(([field, test]) => ({ field, ...test }));

export const whereOf = (tests: readonly EventTest[]): Record<string, Condition> =>
  Object.fromEntries(tests.map(({ field, ...test }) => [field, test]));

export const startOf = (kind: Trigger['kind'], events: readonly EventDef[]): Trigger => {
  switch (kind) {
    case 'manual':
      return { kind };
    case 'event':
      return { kind, event: events[0]?.type ?? '', where: {} };
    case 'schedule':
      return { kind, every: 'day', hour: 6 };
  }
};

const eventOptions = (events: readonly EventDef[], current: string) => [
  ...events.map((e) => ({ value: e.type, label: e.label })),
  ...(current && !events.some((e) => e.type === current)
    ? [{ value: current, label: current }]
    : [])
];

type TestsProps = {
  nodeId: string;
  event: EventDef | undefined;
  tests: EventTest[];
  editable: boolean;
  onChange: (tests: EventTest[]) => void;
};

const EventTests = ({ nodeId, event, tests, editable, onChange }: TestsProps) => {
  const fields = event?.payload ?? [];
  const free = (taken: readonly EventTest[]) =>
    fields.find((f) => !taken.some((t) => t.field === f.name));
  return (
    <ListRows<EventTest>
      id={`${nodeId}-where`}
      noun="Condition"
      items={tests}
      editable={editable && fields.length > tests.length}
      blank={() => ({ field: free(tests)?.name ?? '', op: 'is' })}
      onChange={onChange}
    >
      {(test, i, set) => {
        const field = fields.find((f) => f.name === test.field);
        const column = { name: test.field, type: field?.type ?? 'string' };
        return (
          <div className="grid grid-cols-1 items-start gap-x-4 gap-y-5 sm:grid-cols-2">
            <Select
              id={`${nodeId}-where-${i}-field`}
              label="Field"
              placeholder="Choose a Field"
              options={fields
                .filter((f) => f.name === test.field || !tests.some((t) => t.field === f.name))
                .map((f) => ({ value: f.name, label: pinLabel(f) }))}
              value={test.field}
              onChange={(name) => set({ field: name, op: test.op })}
            />
            <Select
              id={`${nodeId}-where-${i}-op`}
              label="Test"
              options={TEST_OPS}
              value={test.op}
              onChange={(next) => {
                const op = next as ConditionOp;
                set(takesValue(op) ? { ...test, op } : { field: test.field, op });
              }}
            />
            {takesValue(test.op) ? (
              <CellInput
                id={`${nodeId}-where-${i}-value`}
                label="Value"
                hint={takesList(test.op) ? 'Separate items with commas.' : cellHint(column)}
                value={test.value}
                parse={(text) => conditionValue(test.op, text, column.type)}
                onValue={(value) => set({ ...test, value })}
              />
            ) : null}
          </div>
        );
      }}
    </ListRows>
  );
};

export const TriggerEditor = ({ nodeId, config, editable, onConfig }: SettingsEditorProps) => {
  const events = useContext(WorkflowEventsContext);
  const record = recordOf(config);
  const trigger = entryTrigger(config);
  const set = (next: Trigger) => onConfig({ ...record, trigger: next as unknown as Json });
  const event = trigger.kind === 'event' ? events.find((e) => e.type === trigger.event) : undefined;
  return (
    <fieldset disabled={!editable} className="flex min-w-0 flex-col gap-5">
      <Select
        id={`${nodeId}-starts`}
        label="Starts"
        options={STARTS}
        value={trigger.kind}
        onChange={(kind) => set(startOf(kind as Trigger['kind'], events))}
      />
      {trigger.kind === 'event' ? (
        <>
          <Select
            id={`${nodeId}-event`}
            label="Event"
            placeholder="Choose an Event"
            hint={event?.description}
            options={eventOptions(events, trigger.event)}
            value={trigger.event}
            onChange={(type) => set({ kind: 'event', event: type, where: {} })}
          />
          <EventTests
            nodeId={nodeId}
            event={event}
            tests={testsOf(trigger.where)}
            editable={editable}
            onChange={(tests) => set({ ...trigger, where: whereOf(tests) })}
          />
        </>
      ) : null}
      {trigger.kind === 'schedule' ? (
        <div className="grid grid-cols-1 items-start gap-x-4 gap-y-5 sm:grid-cols-2">
          <Select
            id={`${nodeId}-every`}
            label="Repeats"
            options={SCHEDULE_PERIODS.map((p) => ({ value: p, label: SCHEDULE_PERIOD_LABELS[p] }))}
            value={trigger.every}
            onChange={(every) => set({ ...trigger, every: every as SchedulePeriod })}
          />
          <Select
            id={`${nodeId}-hour`}
            label="At"
            hint="In the agency's time zone."
            options={HOURS}
            value={String(trigger.hour)}
            onChange={(hour) => set({ ...trigger, hour: Number(hour) })}
          />
        </div>
      ) : null}
    </fieldset>
  );
};
