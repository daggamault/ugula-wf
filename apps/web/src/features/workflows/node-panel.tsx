import {
  ENTRY_TYPE,
  formatType,
  type GraphDef,
  type InputBinding,
  isPure,
  type Json,
  type NodeInstance,
  type PinSpec,
  RETURN_TYPE
} from '@ugula/graph';
import { Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import type { Catalog } from '../../shared/graph/catalog.ts';
import { updateNode } from '../../shared/graph/flow.ts';
import { Button } from '../../shared/ui/button.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { Select } from '../../shared/ui/select.tsx';
import { Textarea } from '../../shared/ui/textarea.tsx';
import { ValueField } from '../../shared/ui/value-field.tsx';

export type NodePanelProps = {
  def: GraphDef;
  node: NodeInstance;
  catalog: Catalog;
  editable: boolean;
  onChange: (def: GraphDef) => void;
  onDelete: () => void;
};

type BindingMode = 'default' | 'value' | 'expr';

const MODES = [
  { value: 'default', label: 'Default' },
  { value: 'value', label: 'Value' },
  { value: 'expr', label: 'Expression' }
] as const;

const modeOf = (binding: InputBinding | undefined): BindingMode =>
  !binding ? 'default' : 'expr' in binding ? 'expr' : 'value';

const sectionClass = 'border-border flex flex-col gap-3 border-t pt-4';

const headingClass = 'text-surface-fg-muted text-xs font-semibold tracking-wide uppercase';

const BindingEditor = ({
  nodeId,
  spec,
  binding,
  onBind
}: {
  nodeId: string;
  spec: PinSpec;
  binding: InputBinding | undefined;
  onBind: (binding: InputBinding | undefined) => void;
}) => {
  const id = `${nodeId}-${spec.name}`;
  const mode = modeOf(binding);
  return (
    <fieldset className="border-border bg-canvas/50 flex flex-col gap-2 rounded-lg border p-3">
      <legend className="px-1 text-sm font-semibold">
        {spec.label ?? spec.name}{' '}
        <code className="text-surface-fg-muted font-mono text-xs font-normal">
          {formatType(spec.type)}
        </code>
      </legend>
      <Select
        id={`${id}-mode`}
        label="Source"
        options={MODES}
        value={mode}
        onChange={(e) => {
          const next = e.target.value as BindingMode;
          onBind(
            next === 'default'
              ? undefined
              : next === 'value'
                ? { value: spec.default ?? null }
                : { expr: '' }
          );
        }}
      />
      {binding && 'value' in binding ? (
        <ValueField
          key={id}
          id={`${id}-value`}
          label="Value"
          type={spec.type}
          value={binding.value}
          onChange={(value: Json) => onBind({ value })}
        />
      ) : null}
      {binding && 'expr' in binding ? (
        <Input
          id={`${id}-expr`}
          label="Expression"
          hint="Graph variables and functions like round(), sum(), map() are available."
          isMonospace
          value={binding.expr}
          onChange={(e) => onBind({ expr: e.target.value })}
        />
      ) : null}
      {mode === 'default' ? (
        <p className="text-surface-fg-muted text-xs">
          {spec.default !== undefined
            ? `Defaults to ${JSON.stringify(spec.default)}`
            : spec.optional
              ? 'Empty when not set'
              : 'Required: connect a pin or set a value'}
        </p>
      ) : null}
    </fieldset>
  );
};

const ConfigEditor = ({
  node,
  onConfig
}: {
  node: NodeInstance;
  onConfig: (config: Json | undefined) => void;
}) => {
  const [text, setText] = useState(() =>
    node.config === undefined ? '' : JSON.stringify(node.config, null, 2)
  );
  const [error, setError] = useState<string>();
  return (
    <Textarea
      id={`${node.id}-config`}
      label="Configuration"
      hint="JSON settings such as an expression, field list or workflow reference."
      error={error}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        if (!e.target.value.trim()) {
          setError(undefined);
          onConfig(undefined);
          return;
        }
        try {
          onConfig(JSON.parse(e.target.value) as Json);
          setError(undefined);
        } catch {
          setError('Not valid JSON');
        }
      }}
    />
  );
};

export const NodePanel = ({ def, node, catalog, editable, onChange, onDelete }: NodePanelProps) => {
  const signature = catalog.signatureOf(node, def);
  const entry = catalog.palette.find((p) => p.type === node.type && p.version === node.version);
  const connected = new Set(def.edges.filter((e) => e.to === node.id).map((e) => e.toPin));
  const unbound = signature?.inputs.filter((p) => !connected.has(p.name)) ?? [];
  const boundary = node.type === ENTRY_TYPE || node.type === RETURN_TYPE;
  const set = (patch: { [K in keyof NodeInstance]?: NodeInstance[K] | undefined }) =>
    onChange(
      updateNode(
        def,
        node.id,
        Object.fromEntries(
          Object.entries({ ...node, ...patch }).filter(([, value]) => value !== undefined)
        ) as NodeInstance
      )
    );
  const bind = (pin: string, binding: InputBinding | undefined) => {
    const { [pin]: _, ...rest } = node.inputs ?? {};
    set({ inputs: binding ? { ...rest, [pin]: binding } : rest });
  };

  return (
    <section aria-labelledby="node-panel-title" className="flex flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <h2 id="node-panel-title" className="text-lg font-bold tracking-tight">
          {catalog.titleOf(node)}
        </h2>
        <code className="text-surface-fg-muted font-mono text-xs">
          {node.id} · {node.type}@{node.version}
        </code>
        {entry?.description ? (
          <p className="text-surface-fg-muted text-sm">{entry.description}</p>
        ) : null}
      </header>
      <fieldset disabled={!editable} className="flex flex-col gap-4">
        <Input
          id={`${node.id}-label`}
          label="Label"
          placeholder={entry?.title}
          value={node.label ?? ''}
          onChange={(e) => set({ label: e.target.value || undefined })}
        />
        {boundary ? null : (
          <ConfigEditor key={node.id} node={node} onConfig={(config) => set({ config })} />
        )}
        {unbound.length ? (
          <div className={sectionClass}>
            <h3 className={headingClass}>Inputs</h3>
            {unbound.map((spec) => (
              <BindingEditor
                key={`${node.id}-${spec.name}`}
                nodeId={node.id}
                spec={spec}
                binding={node.inputs?.[spec.name]}
                onBind={(binding) => bind(spec.name, binding)}
              />
            ))}
          </div>
        ) : null}
        {signature && !isPure(signature) && !boundary ? (
          <div className={sectionClass}>
            <h3 className={headingClass}>Retry on failure</h3>
            <div className="grid grid-cols-2 gap-3">
              <Input
                id={`${node.id}-retry-max`}
                label="Attempts"
                type="number"
                min={0}
                value={node.retry?.max ?? 0}
                onChange={(e) => {
                  const max = Number(e.target.value);
                  set({
                    retry:
                      max > 0 ? { max, delayMs: node.retry?.delayMs ?? 1000, factor: 2 } : undefined
                  });
                }}
              />
              <Input
                id={`${node.id}-retry-delay`}
                label="First delay (ms)"
                type="number"
                min={0}
                disabled={!node.retry}
                value={node.retry?.delayMs ?? 1000}
                onChange={(e) =>
                  node.retry && set({ retry: { ...node.retry, delayMs: Number(e.target.value) } })
                }
              />
            </div>
          </div>
        ) : null}
        {node.type === ENTRY_TYPE ? null : (
          <Button intent="danger" onClick={onDelete}>
            <Trash2Icon aria-hidden="true" className="size-4" />
            Delete node
          </Button>
        )}
      </fieldset>
    </section>
  );
};
