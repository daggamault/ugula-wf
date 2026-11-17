import type { ConditionOp, Json } from '@ugula/graph';
import { pinLabel } from '../../shared/graph/pins.ts';
import { ListRows } from '../../shared/ui/list-rows.tsx';
import { Select } from '../../shared/ui/select.tsx';
import { asValueType, recordOf, withEntry } from './config-schema.ts';
import type { SettingsEditorProps } from './settings-editor.ts';
import { conditionValue, OPS, takesList, takesValue } from './table-config.ts';
import { CellInput, cellHint } from './table-editors.tsx';
import { FieldsEditor, fieldsOf } from './task-editor.tsx';

type Rule = { field: string; op: ConditionOp; value?: Json };

const MATCH = [
  { value: 'all', label: 'Every Rule Holds' },
  { value: 'any', label: 'Any Rule Holds' }
];

const RULE_OPS = OPS.filter((o) => o.value !== '');

const isRule = (x: Json): x is Rule =>
  typeof x === 'object' && x !== null && !Array.isArray(x) && typeof x.field === 'string';

export const rulesOf = (value: Json | undefined): Rule[] =>
  Array.isArray(value) ? value.filter(isRule) : [];

export const ConditionEditor = ({ nodeId, config, editable, onConfig }: SettingsEditorProps) => {
  const record = recordOf(config);
  const inputs = fieldsOf(record.inputs);
  const rules = rulesOf(record.rules);
  const names = inputs.flatMap((i) => (typeof i.name === 'string' ? [i.name] : []));
  const columnOf = (name: string) => {
    const input = inputs.find((i) => i.name === name);
    const label = typeof input?.label === 'string' ? input.label : undefined;
    return { name, type: asValueType(input?.type), ...(label ? { label } : {}) };
  };
  const setRules = (next: Rule[]) => onConfig({ ...record, rules: next as unknown as Json });
  return (
    <fieldset disabled={!editable} className="flex min-w-0 flex-col gap-5">
      <Select
        id={`${nodeId}-match`}
        label="Holds When"
        options={MATCH}
        value={record.match === 'any' ? 'any' : 'all'}
        onChange={(match) => onConfig({ ...record, match })}
      />
      <FieldsEditor
        id={`${nodeId}-inputs`}
        fields={inputs}
        editable={editable}
        onChange={(fields) => onConfig(withEntry(record, 'inputs', fields))}
      />
      <ListRows<Rule>
        id={`${nodeId}-rules`}
        noun="Rule"
        items={rules}
        editable={editable}
        blank={() => ({ field: names[0] ?? '', op: 'is' })}
        onChange={setRules}
      >
        {(rule, i, set) => {
          const column = columnOf(rule.field);
          return (
            <div className="grid grid-cols-1 items-start gap-x-4 gap-y-5 sm:grid-cols-3">
              <Select
                id={`${nodeId}-rule-${i}-field`}
                label="Input"
                placeholder="Choose an input"
                options={names.map((n) => ({ value: n, label: pinLabel(columnOf(n)) }))}
                value={rule.field}
                onChange={(field) => set({ ...rule, field })}
              />
              <Select
                id={`${nodeId}-rule-${i}-op`}
                label="Test"
                options={RULE_OPS}
                value={rule.op}
                onChange={(next) => {
                  const op = next as ConditionOp;
                  set(takesValue(op) ? { ...rule, op } : { field: rule.field, op });
                }}
              />
              {takesValue(rule.op) ? (
                <CellInput
                  id={`${nodeId}-rule-${i}-value`}
                  label="Value"
                  hint={takesList(rule.op) ? 'Separate items with commas.' : cellHint(column)}
                  value={rule.value}
                  parse={(text) => conditionValue(rule.op, text, column.type)}
                  onValue={(value) => set({ ...rule, value })}
                />
              ) : null}
            </div>
          );
        }}
      </ListRows>
    </fieldset>
  );
};
