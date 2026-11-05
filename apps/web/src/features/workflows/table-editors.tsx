import { type ConditionOp, deepEqual, type Json } from '@ugula/graph';
import { ArrowDownIcon, ArrowUpIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { pinLabel } from '../../shared/graph/pins.ts';
import { Button } from '../../shared/ui/button.tsx';
import { IconButton, RemoveButton } from '../../shared/ui/icon-button.tsx';
import { Input, type InputProps } from '../../shared/ui/input.tsx';
import { Section } from '../../shared/ui/section-panel.tsx';
import { Select } from '../../shared/ui/select.tsx';
import {
  COLUMN_TYPES,
  type Column,
  columnKind,
  columnNameError,
  columnType,
  conditionValue,
  type DecisionConfig,
  formatCell,
  freeName,
  type LookupConfig,
  moveRule,
  OPS,
  parseCell,
  type Rule,
  readDecision,
  readLookup,
  removeColumn,
  renameColumn,
  takesList,
  takesValue,
  toJson
} from './table-config.ts';

type TableEditorProps = {
  nodeId: string;
  config: Json | undefined;
  editable: boolean;
  onConfig: (config: Json) => void;
};

const ColumnName = ({
  id,
  table,
  side,
  column,
  onChange
}: {
  id: string;
  table: DecisionConfig;
  side: 'inputs' | 'outputs';
  column: Column;
  onChange: (next: DecisionConfig) => void;
}) => {
  const [text, setText] = useState(column.name);
  const error = columnNameError(table, side, column.name, text);
  const shown = error || text.trim() === column.name ? text : column.name;
  return (
    <Input
      id={id}
      label="Name"
      isMonospace
      value={shown}
      error={error}
      onChange={(e) => {
        setText(e.target.value);
        onChange(renameColumn(table, side, column.name, e.target.value));
      }}
    />
  );
};

const AddButton = ({ children, onClick }: { children: string; onClick: () => void }) => (
  <Button variant="outline" size="sm" onClick={onClick}>
    <PlusIcon aria-hidden="true" className="size-4" />
    {children}
  </Button>
);

type CellInputProps = Omit<InputProps, 'value' | 'onChange'> & {
  value: Json | undefined;
  parse: (text: string) => Json;
  onValue: (value: Json) => void;
};

const CellInput = ({ value, parse, onValue, ...rest }: CellInputProps) => {
  const [text, setText] = useState(() => formatCell(value));
  const shown = deepEqual(parse(text), value ?? null) ? text : formatCell(value);
  return (
    <Input
      {...rest}
      value={shown}
      onChange={(e) => {
        setText(e.target.value);
        onValue(parse(e.target.value));
      }}
    />
  );
};

const cellHint = (column: Column) =>
  columnKind(column.type) === 'list'
    ? 'Separate items with commas.'
    : columnKind(column.type) === 'boolean'
      ? 'true or false.'
      : undefined;

export const LookupTableEditor = ({ nodeId, config, editable, onConfig }: TableEditorProps) => {
  const table = readLookup(config);
  const set = (next: Partial<LookupConfig>) => onConfig(toJson({ ...table, ...next }));
  const column = { name: 'value', type: table.type };
  return (
    <fieldset disabled={!editable} className="flex flex-col gap-3">
      <Select
        id={`${nodeId}-lookup-type`}
        label="Values Are"
        options={COLUMN_TYPES}
        value={columnKind(table.type)}
        onChange={(v) => set({ type: columnType(v) })}
      />
      <ul className="flex flex-col gap-3">
        {table.rows.map((row, i) => (
          <li
            key={`${nodeId}-row-${i.toString()}`}
            className="border-border grid grid-cols-2 items-start gap-x-4 gap-y-5 rounded-xl border p-4"
          >
            <Input
              id={`${nodeId}-key-${i}`}
              label="Key"
              isMonospace
              value={row.key}
              onChange={(e) =>
                set({
                  rows: table.rows.map((r, j) => (j === i ? { ...r, key: e.target.value } : r))
                })
              }
            />
            <CellInput
              id={`${nodeId}-value-${i}`}
              label="Value"
              hint={cellHint(column)}
              value={row.value}
              parse={(text) => parseCell(text, table.type)}
              onValue={(value) =>
                set({ rows: table.rows.map((r, j) => (j === i ? { ...r, value } : r)) })
              }
            />
            {editable ? (
              <div className="col-span-2 flex justify-end">
                <RemoveButton
                  label={`Remove ${row.key || 'row'}`}
                  onClick={() => set({ rows: table.rows.filter((_, j) => j !== i) })}
                />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {editable ? (
        <div>
          <AddButton onClick={() => set({ rows: [...table.rows, { key: '', value: null }] })}>
            Add Row
          </AddButton>
        </div>
      ) : null}
      <CellInput
        id={`${nodeId}-fallback`}
        label="When the Key Is Not Listed"
        hint="Left empty, the value is empty."
        value={table.fallback}
        parse={(text) => parseCell(text, table.type)}
        onValue={(fallback) => set({ fallback })}
      />
    </fieldset>
  );
};

const ColumnsEditor = ({
  nodeId,
  side,
  table,
  editable,
  onChange
}: {
  nodeId: string;
  side: 'inputs' | 'outputs';
  table: DecisionConfig;
  editable: boolean;
  onChange: (next: DecisionConfig) => void;
}) => {
  const columns = table[side];
  const noun = side === 'inputs' ? 'input' : 'output';
  return (
    <Section
      title={side === 'inputs' ? 'What the Rules Check' : 'What the Rules Decide'}
      description={
        side === 'inputs'
          ? 'The values each rule compares before it holds.'
          : 'The values a rule hands back when it holds.'
      }
    >
      <ul className="flex flex-col gap-2">
        {columns.map((c, i) => (
          <li
            key={`${nodeId}-${side}-${i.toString()}`}
            className="grid grid-cols-2 items-start gap-x-4 gap-y-5"
          >
            <ColumnName
              id={`${nodeId}-${side}-${i}-name`}
              table={table}
              side={side}
              column={c}
              onChange={onChange}
            />
            <Select
              id={`${nodeId}-${side}-${i}-type`}
              label="Type"
              options={COLUMN_TYPES}
              value={columnKind(c.type)}
              onChange={(v) =>
                onChange({
                  ...table,
                  [side]: columns.map((x) =>
                    x.name === c.name ? { ...x, type: columnType(v) } : x
                  )
                })
              }
            />
            {editable ? (
              <div className="col-span-2 flex justify-end">
                <RemoveButton
                  label={`Remove ${noun} ${c.name}`}
                  onClick={() => onChange(removeColumn(table, side, c.name))}
                />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {editable ? (
        <div>
          <AddButton
            onClick={() =>
              onChange({
                ...table,
                [side]: [
                  ...columns,
                  {
                    name: freeName(
                      columns.map((x) => x.name),
                      noun
                    ),
                    type: 'string'
                  }
                ]
              })
            }
          >
            {side === 'inputs' ? 'Add Input' : 'Add Output'}
          </AddButton>
        </div>
      ) : null}
    </Section>
  );
};

const RuleEditor = ({
  nodeId,
  index,
  rule,
  table,
  editable,
  onRule,
  onMove,
  onRemove
}: {
  nodeId: string;
  index: number;
  rule: Rule;
  table: DecisionConfig;
  editable: boolean;
  onRule: (rule: Rule) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) => {
  const id = `${nodeId}-rule-${index}`;
  const name = rule.label || `rule ${index + 1}`;
  return (
    <li className="border-border flex flex-col gap-4 rounded-xl border p-4">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Input
            id={`${id}-label`}
            label={`Rule ${index + 1}`}
            value={rule.label}
            onChange={(e) => onRule({ ...rule, label: e.target.value })}
          />
        </div>
        {editable ? (
          <div className="flex items-center gap-1">
            <IconButton
              label={`Move ${name} up`}
              tooltip="Move Up"
              icon={ArrowUpIcon}
              disabledReason={index === 0 ? 'Already first.' : undefined}
              onClick={() => onMove(-1)}
            />
            <IconButton
              label={`Move ${name} down`}
              tooltip="Move Down"
              icon={ArrowDownIcon}
              disabledReason={index === table.rules.length - 1 ? 'Already last.' : undefined}
              onClick={() => onMove(1)}
            />
          </div>
        ) : null}
      </div>
      {table.inputs.map((c, i) => {
        const condition = rule.when[c.name];
        const op = condition?.op ?? '';
        return (
          <div key={`${i}-${c.name}`} className="grid grid-cols-2 items-start gap-x-4 gap-y-5">
            <Select
              id={`${id}-${c.name}-op`}
              label={`When ${pinLabel(c)}`}
              options={OPS}
              value={op}
              onChange={(v) => {
                const next = v as ConditionOp | '';
                const { [c.name]: _, ...rest } = rule.when;
                onRule({
                  ...rule,
                  when: next
                    ? {
                        ...rest,
                        [c.name]: {
                          op: next,
                          ...(condition?.value === undefined ? {} : { value: condition.value })
                        }
                      }
                    : rest
                });
              }}
            />
            {op && takesValue(op) ? (
              <CellInput
                id={`${id}-${c.name}-value`}
                label="Value"
                hint={takesList(op) ? 'Separate items with commas.' : cellHint(c)}
                value={condition?.value}
                parse={(text) => conditionValue(op, text, c.type)}
                onValue={(value) =>
                  onRule({ ...rule, when: { ...rule.when, [c.name]: { op, value } } })
                }
              />
            ) : null}
          </div>
        );
      })}
      {table.outputs.map((c, i) => (
        <CellInput
          key={`${i}-${c.name}`}
          id={`${id}-${c.name}-set`}
          label={`Then ${pinLabel(c)}`}
          hint={cellHint(c)}
          value={rule.set[c.name]}
          parse={(text) => parseCell(text, c.type)}
          onValue={(value) => onRule({ ...rule, set: { ...rule.set, [c.name]: value } })}
        />
      ))}
      {editable ? (
        <div className="flex justify-end">
          <RemoveButton label={`Remove ${name}`} onClick={onRemove} />
        </div>
      ) : null}
    </li>
  );
};

export const DecisionTableEditor = ({ nodeId, config, editable, onConfig }: TableEditorProps) => {
  const table = readDecision(config);
  const change = (next: DecisionConfig) => onConfig(toJson(next));
  const setRules = (rules: Rule[]) => change({ ...table, rules });
  return (
    <fieldset disabled={!editable} className="flex flex-col gap-5">
      <ColumnsEditor
        nodeId={nodeId}
        side="inputs"
        table={table}
        editable={editable}
        onChange={change}
      />
      <ColumnsEditor
        nodeId={nodeId}
        side="outputs"
        table={table}
        editable={editable}
        onChange={change}
      />
      <Section
        title="Rules"
        description="Checked top to bottom, and the label of the first that holds is the reason."
      >
        <ol className="flex flex-col gap-3">
          {table.rules.map((rule, i) => (
            <RuleEditor
              key={`${nodeId}-rule-${i.toString()}`}
              nodeId={nodeId}
              index={i}
              rule={rule}
              table={table}
              editable={editable}
              onRule={(next) => setRules(table.rules.map((r, j) => (j === i ? next : r)))}
              onMove={(by) => setRules(moveRule(table.rules, i, by))}
              onRemove={() => setRules(table.rules.filter((_, j) => j !== i))}
            />
          ))}
        </ol>
        {editable ? (
          <div>
            <AddButton
              onClick={() =>
                setRules([
                  ...table.rules,
                  { label: `Rule ${table.rules.length + 1}`, when: {}, set: {} }
                ])
              }
            >
              Add Rule
            </AddButton>
          </div>
        ) : null}
      </Section>
      <Section
        title="When No Rule Holds"
        description="The values handed back when nothing matches."
      >
        {table.outputs.map((c, i) => (
          <CellInput
            key={`${i}-${c.name}`}
            id={`${nodeId}-otherwise-${c.name}`}
            label={pinLabel(c)}
            hint={cellHint(c)}
            value={table.otherwise[c.name]}
            parse={(text) => parseCell(text, c.type)}
            onValue={(value) =>
              change({ ...table, otherwise: { ...table.otherwise, [c.name]: value } })
            }
          />
        ))}
      </Section>
    </fieldset>
  );
};
