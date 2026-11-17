import { fieldPaths, formatType, type Json, pathLabel, type ValueType } from '@ugula/graph';
import { useContext } from 'react';
import type { PublishedNode } from '../../shared/graph/catalog.ts';
import { pinLabel, ValueKindsContext } from '../../shared/graph/pins.ts';
import { kindOptions, TypePicker } from '../../shared/graph/type-picker.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { Select, type SelectOption } from '../../shared/ui/select.tsx';
import { ValueField } from '../../shared/ui/value-field.tsx';
import { asValueType, recordOf, withEntry } from './config-schema.ts';
import type { SettingsEditorProps } from './settings-editor.ts';

const textOf = (value: Json | undefined) => (typeof value === 'string' ? value : '');

const withCurrent = (options: SelectOption[], current: string) =>
  !current || options.some((o) => o.value === current)
    ? options
    : [...options, { value: current, label: current }];

export const workflowOptions = (published: readonly PublishedNode[], current: string) =>
  withCurrent(
    [
      ...new Map(
        published.filter((p) => p.kind === 'workflow').map((p) => [p.key, p.name] as const)
      )
    ]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    current
  );

export const versionsOf = (published: readonly PublishedNode[], key: string) =>
  [...new Set(published.filter((p) => p.key === key).map((p) => p.version))].sort((a, b) => b - a);

export const WorkflowEditor = ({
  nodeId,
  config,
  editable,
  onConfig,
  catalog
}: SettingsEditorProps) => {
  const record = recordOf(config);
  const workflow = textOf(record.workflow);
  const version = typeof record.version === 'number' ? record.version : null;
  const versions = versionsOf(catalog.published, workflow);
  return (
    <fieldset disabled={!editable} className="flex min-w-0 flex-col gap-5">
      <Select
        id={`${nodeId}-workflow`}
        label="Workflow"
        placeholder="Choose a workflow"
        options={workflowOptions(catalog.published, workflow)}
        value={workflow}
        onChange={(key) => {
          const latest = versionsOf(catalog.published, key)[0];
          onConfig({
            ...record,
            workflow: key,
            ...(latest === undefined ? {} : { version: latest })
          });
        }}
      />
      {workflow ? (
        <Select
          id={`${nodeId}-version`}
          label="Version"
          options={withCurrent(
            versions.map((n) => ({ value: String(n), label: `Version ${n}` })),
            version === null ? '' : String(version)
          )}
          value={version === null ? '' : String(version)}
          onChange={(n) => onConfig({ ...record, version: Number(n) })}
        />
      ) : null}
    </fieldset>
  );
};

export const ruleOptions = (published: readonly PublishedNode[], current: string) =>
  withCurrent(
    [
      ...new Map(
        published
          .filter(
            (p) => p.kind === 'node' && !p.signature.execIn.length && !p.signature.execOut.length
          )
          .map((p) => [p.key, p.name] as const)
      )
    ]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    current
  );

const ruleEditor =
  (withTest: boolean) =>
  ({ nodeId, config, editable, onConfig, catalog }: SettingsEditorProps) => {
    const record = recordOf(config);
    const rule = textOf(record.rule);
    const version = typeof record.version === 'number' ? record.version : null;
    const signatureOf = (key: string, n: number | null) =>
      catalog.published.find((p) => p.key === key && p.version === n)?.signature;
    const sig = signatureOf(rule, version);
    const tests = sig?.outputs.filter((p) => p.type === 'boolean') ?? [];
    const pick = (key: string, n: number | undefined) => {
      const next = n === undefined ? undefined : signatureOf(key, n);
      onConfig({
        ...record,
        rule: key,
        ...(n === undefined ? {} : { version: n }),
        ...(next?.inputs[0] ? { item: next.inputs[0].name } : {}),
        ...(withTest && next
          ? { test: next.outputs.find((p) => p.type === 'boolean')?.name ?? '' }
          : {})
      });
    };
    const pinOptions = (pins: readonly { name: string; label?: string }[], current: string) =>
      withCurrent(
        pins.map((p) => ({ value: p.name, label: pinLabel(p) })),
        current
      );
    return (
      <fieldset disabled={!editable} className="flex min-w-0 flex-col gap-5">
        <Select
          id={`${nodeId}-rule`}
          label="Rule"
          placeholder="Choose a rule"
          options={ruleOptions(catalog.published, rule)}
          value={rule}
          onChange={(key) => pick(key, versionsOf(catalog.published, key)[0])}
        />
        {rule ? (
          <Select
            id={`${nodeId}-version`}
            label="Version"
            options={withCurrent(
              versionsOf(catalog.published, rule).map((n) => ({
                value: String(n),
                label: `Version ${n}`
              })),
              version === null ? '' : String(version)
            )}
            value={version === null ? '' : String(version)}
            onChange={(n) => pick(rule, Number(n))}
          />
        ) : null}
        {sig ? (
          <Select
            id={`${nodeId}-item`}
            label="Each Item Goes To"
            options={pinOptions(sig.inputs, textOf(record.item))}
            value={textOf(record.item)}
            onChange={(item) => onConfig({ ...record, item })}
          />
        ) : null}
        {sig && withTest ? (
          <Select
            id={`${nodeId}-test`}
            label="Keep When"
            placeholder="Choose a true or false output"
            options={pinOptions(tests, textOf(record.test))}
            value={textOf(record.test)}
            onChange={(test) => onConfig({ ...record, test })}
          />
        ) : null}
      </fieldset>
    );
  };

export const RuleEditor = ruleEditor(false);

export const RuleTestEditor = ruleEditor(true);

export const ConstantEditor = ({ nodeId, config, editable, onConfig }: SettingsEditorProps) => {
  const record = recordOf(config);
  const type = asValueType(record.type);
  return (
    <fieldset disabled={!editable} className="flex min-w-0 flex-col gap-5">
      <TypePicker
        id={`${nodeId}-type`}
        label="Type"
        value={type}
        editable={editable}
        onChange={(next) => onConfig({ ...record, type: next, value: null })}
      />
      <ValueField
        key={formatType(type)}
        id={`${nodeId}-value`}
        label="Value"
        type={type}
        value={record.value ?? null}
        editable={editable}
        onChange={(value) => onConfig({ ...record, value })}
      />
    </fieldset>
  );
};

export const fieldOptions = (record: ValueType, current: string) =>
  withCurrent(
    fieldPaths(record).map((f) => ({ value: f.path, label: pathLabel(f.path) })),
    current
  );

export const FieldEditor = ({ nodeId, config, editable, onConfig }: SettingsEditorProps) => {
  const record = recordOf(config);
  const type = asValueType(record.record);
  const path = textOf(record.path);
  const options = fieldOptions(type, path);
  return (
    <fieldset disabled={!editable} className="flex min-w-0 flex-col gap-5">
      {options.length ? (
        <Select
          id={`${nodeId}-path`}
          label="Field"
          placeholder="Choose a field"
          options={options}
          value={path}
          onChange={(next) => onConfig({ ...record, path: next })}
        />
      ) : (
        <Input
          id={`${nodeId}-path`}
          label="Field"
          hint="Wire a record in to choose from its fields, or type the field's path."
          value={path}
          onChange={(e) => onConfig({ ...record, path: e.currentTarget.value })}
        />
      )}
      <TypePicker
        id={`${nodeId}-record`}
        label="Record"
        value={type}
        editable={editable}
        onChange={(next) => onConfig({ ...record, record: next })}
      />
    </fieldset>
  );
};

export const CodeSetEditor = ({ nodeId, config, editable, onConfig }: SettingsEditorProps) => {
  const kinds = useContext(ValueKindsContext);
  const record = recordOf(config);
  const kind = textOf(record.kind);
  return (
    <fieldset disabled={!editable} className="flex min-w-0 flex-col gap-5">
      <Select
        id={`${nodeId}-kind`}
        label="Code Set"
        placeholder="Choose a code set"
        options={kindOptions(kinds.code, kind).filter((o) => o.value)}
        value={kind}
        onChange={(next) => onConfig({ ...record, kind: next })}
      />
    </fieldset>
  );
};

const namePicker =
  (
    field: string,
    label: string,
    placeholder: string,
    optionsOf: (props: SettingsEditorProps) => SelectOption[]
  ) =>
  (props: SettingsEditorProps) => {
    const { nodeId, config, editable, onConfig } = props;
    const record = recordOf(config);
    const current = textOf(record[field]);
    return (
      <fieldset disabled={!editable} className="flex min-w-0 flex-col gap-5">
        <Select
          id={`${nodeId}-${field}`}
          label={label}
          placeholder={placeholder}
          options={withCurrent(optionsOf(props), current)}
          value={current}
          onChange={(next) => onConfig(withEntry(record, field, next))}
        />
      </fieldset>
    );
  };

export const VariableEditor = namePicker('name', 'Variable', 'Choose a variable', ({ def }) =>
  def.variables.map((x) => ({ value: x.name, label: x.name }))
);

export const GraphInputEditor = namePicker('pin', 'Input', 'Choose an input', ({ def }) =>
  def.signature.inputs.map((p) => ({ value: p.name, label: pinLabel(p) }))
);
