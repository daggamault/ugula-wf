import { PERMISSION_DESCRIPTIONS, PERMISSIONS } from '@ugula/access';
import { isRecord, isTextType, type Json, TASK_PREFILLS, type ValueType } from '@ugula/graph';
import { freeFieldName, TypePicker } from '../../shared/graph/type-picker.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { ListRows } from '../../shared/ui/list-rows.tsx';
import { Section } from '../../shared/ui/section-panel.tsx';
import { Select } from '../../shared/ui/select.tsx';
import { Textarea } from '../../shared/ui/textarea.tsx';
import { ChoicesField } from './config-form.tsx';
import { asValueType, recordOf, withEntry } from './config-schema.ts';
import type { SettingsEditorProps } from './settings-editor.ts';

type TaskField = Record<string, Json>;

type Outcome = { name: string; hint: string };

const PREFILL_LABELS: Record<(typeof TASK_PREFILLS)[number], string> = {
  current: 'Current Values',
  suggested: 'Suggestions'
};

const PREFILLS = [
  { value: '', label: 'Starting Values' },
  ...TASK_PREFILLS.map((p) => ({ value: p, label: PREFILL_LABELS[p] }))
];

const PERMISSION_OPTIONS = [
  { value: '', label: 'Anyone in the Queue' },
  ...PERMISSIONS.map((p) => ({
    value: p,
    label: `${PERMISSION_DESCRIPTIONS[p].replace(/\.$/, '')} (${p})`
  }))
];

const textOf = (value: Json | undefined) => (typeof value === 'string' ? value : '');

const stringsOf = (value: Json | undefined) =>
  Array.isArray(value) ? value.filter((x) => typeof x === 'string') : [];

export const fieldsOf = (value: Json | undefined): TaskField[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

export const outcomesOf = (config: Readonly<Record<string, Json>>): Outcome[] => {
  const hints = recordOf(config.hints);
  return stringsOf(config.outcomes).map((name) => ({ name, hint: textOf(hints[name]) }));
};

const takesChoices = (type: ValueType) =>
  isTextType(type) || (typeof type === 'object' && 'list' in type && isTextType(type.list));

export const withOutcomes = (
  config: Readonly<Record<string, Json>>,
  outcomes: readonly Outcome[]
): Record<string, Json> => {
  const before = stringsOf(config.outcomes);
  const names = outcomes.map((o) => o.name);
  const renamed = (name: string) =>
    names.includes(name) || before.length !== names.length
      ? name
      : (names[before.indexOf(name)] ?? name);
  const fields = fieldsOf(config.fields).map((f) => {
    if (!Array.isArray(f.required)) return f;
    const required = stringsOf(f.required)
      .map(renamed)
      .filter((n) => names.includes(n));
    return withEntry(f, 'required', required.length ? required : undefined);
  });
  const hints = Object.fromEntries(outcomes.filter((o) => o.hint).map((o) => [o.name, o.hint]));
  return {
    ...withEntry(config, 'hints', Object.keys(hints).length ? hints : undefined),
    outcomes: names,
    ...(Array.isArray(config.fields) ? { fields } : {})
  };
};

export const FieldsEditor = ({
  id,
  fields,
  outcomes,
  editable,
  onChange
}: {
  id: string;
  fields: readonly TaskField[];
  outcomes?: readonly string[] | undefined;
  editable: boolean;
  onChange: (fields: TaskField[]) => void;
}) => (
  <ListRows<TaskField>
    id={id}
    noun="Field"
    items={fields}
    editable={editable}
    blank={() => ({
      name: freeFieldName(fields.map((f) => textOf(f.name))),
      type: 'string'
    })}
    nameOf={(f, i) => textOf(f.label) || textOf(f.name) || `field ${i + 1}`}
    onChange={onChange}
  >
    {(field, i, set) => {
      const type = asValueType(field.type ?? 'string');
      return (
        <div className="border-border flex flex-col gap-3 rounded-xl border p-4">
          <div className="grid grid-cols-2 gap-x-4">
            <Input
              id={`${id}-${i}-name`}
              label="Name"
              isMonospace
              required
              value={textOf(field.name)}
              onChange={(e) => set({ ...field, name: e.target.value })}
            />
            <Input
              id={`${id}-${i}-label`}
              label="Label"
              value={textOf(field.label)}
              onChange={(e) => set(withEntry(field, 'label', e.target.value || undefined))}
            />
          </div>
          <TypePicker
            id={`${id}-${i}-type`}
            label="Type"
            value={type}
            editable={editable}
            isFieldType
            onChange={(next) => set({ ...field, type: next })}
          />
          {outcomes ? (
            <>
              <Select
                id={`${id}-${i}-required`}
                label="Required To"
                isMultiple
                placeholder="Never Required"
                options={outcomes.map((o) => ({ value: o, label: o }))}
                value={stringsOf(field.required)}
                onChange={(required) =>
                  set(withEntry(field, 'required', required.length ? required : undefined))
                }
              />
              {takesChoices(type) ? (
                <ChoicesField
                  id={`${id}-${i}-options`}
                  label="Choices"
                  value={field.options}
                  editable={editable}
                  onChange={(options) =>
                    set(
                      withEntry(
                        field,
                        'options',
                        Array.isArray(options) && options.length ? options : undefined
                      )
                    )
                  }
                />
              ) : null}
            </>
          ) : null}
        </div>
      );
    }}
  </ListRows>
);

export const TaskEditor = ({ nodeId, config, editable, onConfig }: SettingsEditorProps) => {
  const record = recordOf(config);
  const set = (name: string, value: Json | undefined) => onConfig(withEntry(record, name, value));
  const outcomes = outcomesOf(record);
  return (
    <fieldset disabled={!editable} className="flex min-w-0 flex-col gap-5">
      <Input
        id={`${nodeId}-title`}
        label="Title"
        required
        value={textOf(record.title)}
        onChange={(e) => set('title', e.target.value)}
      />
      <Input
        id={`${nodeId}-queue`}
        label="Queue"
        required
        value={textOf(record.queue)}
        onChange={(e) => set('queue', e.target.value)}
      />
      <Textarea
        id={`${nodeId}-instructions`}
        label="Instructions"
        value={textOf(record.instructions)}
        onChange={(e) => set('instructions', e.target.value || undefined)}
      />
      <Select
        id={`${nodeId}-permission`}
        label="Who Can Complete It"
        options={PERMISSION_OPTIONS}
        value={textOf(record.permission)}
        onChange={(p) => set('permission', p || undefined)}
      />
      <Select
        id={`${nodeId}-prefill`}
        label="Defaults Are"
        hint="Current values show as current → new once changed."
        options={PREFILLS}
        value={textOf(record.prefill)}
        onChange={(p) => set('prefill', p || undefined)}
      />
      <Section title="Outcomes">
        <ListRows<Outcome>
          id={`${nodeId}-outcomes`}
          noun="Outcome"
          items={outcomes}
          editable={editable}
          blank={() => ({ name: `outcome${outcomes.length + 1}`, hint: '' })}
          nameOf={(o, i) => o.name || `outcome ${i + 1}`}
          onChange={(next) => onConfig(withOutcomes(record, next))}
        >
          {(o, i, setOutcome) => (
            <div className="grid grid-cols-2 gap-x-4">
              <Input
                id={`${nodeId}-outcome-${i}`}
                label="Name"
                isMonospace
                required
                value={o.name}
                onChange={(e) => setOutcome({ ...o, name: e.target.value })}
              />
              <Input
                id={`${nodeId}-outcome-${i}-hint`}
                label="Hint"
                value={o.hint}
                onChange={(e) => setOutcome({ ...o, hint: e.target.value })}
              />
            </div>
          )}
        </ListRows>
      </Section>
      <Section title="Fields">
        <FieldsEditor
          id={`${nodeId}-fields`}
          fields={fieldsOf(record.fields)}
          outcomes={outcomes.map((o) => o.name)}
          editable={editable}
          onChange={(fields) => set('fields', fields)}
        />
      </Section>
    </fieldset>
  );
};

export const RecordFieldsEditor = ({ nodeId, config, editable, onConfig }: SettingsEditorProps) => {
  const record = recordOf(config);
  return (
    <fieldset disabled={!editable} className="flex min-w-0 flex-col gap-5">
      <FieldsEditor
        id={`${nodeId}-fields`}
        fields={fieldsOf(record.fields)}
        editable={editable}
        onChange={(fields) => onConfig(withEntry(record, 'fields', fields))}
      />
    </fieldset>
  );
};
