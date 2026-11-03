import {
  ENTRY_TYPE,
  type GraphDef,
  type InputBinding,
  isPure,
  type Json,
  type NodeInstance,
  type PinSpec,
  RETURN_TYPE
} from '@ugula/graph';
import { ExternalLinkIcon, Trash2Icon, XIcon } from 'lucide-react';
import { useId, useState } from 'react';
import type { Catalog } from '../../shared/graph/catalog.ts';
import { updateNode } from '../../shared/graph/flow.ts';
import { describeType, pinLabel } from '../../shared/graph/pins.ts';
import { Button } from '../../shared/ui/button.tsx';
import { IconButton } from '../../shared/ui/icon-button.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { Select } from '../../shared/ui/select.tsx';
import { Textarea } from '../../shared/ui/textarea.tsx';
import { ValueField } from '../../shared/ui/value-field.tsx';
import { DecisionTableEditor, LookupTableEditor } from './table-editors.tsx';

const TABLE_EDITORS = {
  'std.table.lookup': LookupTableEditor,
  'std.table.decide': DecisionTableEditor
} as const;

type NodeInspectorProps = {
  def: GraphDef;
  node: NodeInstance;
  catalog: Catalog;
  editable: boolean;
  onChange: (def: GraphDef) => void;
  onDelete: () => void;
  onOpen?: (() => void) | undefined;
  onClose: () => void;
};

type BindingMode = 'default' | 'value' | 'expr';

const MODES = [
  { value: 'default', label: 'Not Set' },
  { value: 'value', label: 'A Fixed Value' },
  { value: 'expr', label: 'An Expression' }
] as const;

const modeOf = (binding: InputBinding | undefined): BindingMode =>
  !binding ? 'default' : 'expr' in binding ? 'expr' : 'value';

const PinHeading = ({ spec }: { spec: PinSpec }) => (
  <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
    <span className="text-sm font-semibold">{pinLabel(spec)}</span>
    <span className="text-surface-fg-muted text-xs">
      {describeType(spec.type)}
      {spec.optional ? ', optional' : ''}
    </span>
  </span>
);

const unsetText = (spec: PinSpec) =>
  spec.default !== undefined
    ? `Uses ${JSON.stringify(spec.default)} unless you set it.`
    : spec.optional
      ? 'Left empty unless you set it.'
      : 'Needs a value: connect a pin on the canvas, or set one here.';

const BindingEditor = ({
  nodeId,
  spec,
  binding,
  editable,
  onBind
}: {
  nodeId: string;
  spec: PinSpec;
  binding: InputBinding | undefined;
  editable: boolean;
  onBind: (binding: InputBinding | undefined) => void;
}) => {
  const id = `${nodeId}-${spec.name}`;
  const mode = modeOf(binding);
  return (
    <li className="border-border flex flex-col gap-4 rounded-xl border p-4">
      <PinHeading spec={spec} />
      <fieldset disabled={!editable} className="flex flex-col gap-3">
        <Select
          id={`${id}-mode`}
          label="Value"
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
            label="Fixed Value"
            type={spec.type}
            value={binding.value}
            onChange={(value: Json) => onBind({ value })}
          />
        ) : null}
        {binding && 'expr' in binding ? (
          <Input
            id={`${id}-expr`}
            label="Expression"
            hint="Use graph variables and functions such as round(), sum() or map()."
            isMonospace
            value={binding.expr}
            onChange={(e) => onBind({ expr: e.target.value })}
          />
        ) : null}
        {mode === 'default' ? (
          <p className="text-surface-fg-muted text-xs">{unsetText(spec)}</p>
        ) : null}
      </fieldset>
    </li>
  );
};

const ConfigEditor = ({
  node,
  editable,
  onConfig
}: {
  node: NodeInstance;
  editable: boolean;
  onConfig: (config: Json | undefined) => void;
}) => {
  const [text, setText] = useState(() =>
    node.config === undefined ? '' : JSON.stringify(node.config, null, 2)
  );
  const [error, setError] = useState<string>();
  return (
    <Textarea
      isMonospace
      id={`${node.id}-config`}
      label="Settings (JSON)"
      hint="For example the expression to evaluate, the fields of a task, or which workflow to start."
      error={error}
      disabled={!editable}
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
          setError('This is not valid JSON yet.');
        }
      }}
    />
  );
};

const Links = ({ items, empty }: { items: readonly string[]; empty: string }) => (
  <span className={items.length ? 'text-sm' : 'text-surface-fg-muted text-sm'}>
    {items.length ? items.join(', ') : empty}
  </span>
);

export const NodeInspector = ({
  def,
  node,
  catalog,
  editable,
  onChange,
  onDelete,
  onOpen,
  onClose
}: NodeInspectorProps) => {
  const titleId = useId();
  const signature = catalog.signatureOf(node, def);
  const titleOfId = (id: string) => {
    const other = def.nodes.find((n) => n.id === id);
    return other ? catalog.titleOf(other) : id;
  };
  const incoming = (pin: string) =>
    def.edges
      .filter((e) => e.to === node.id && e.toPin === pin)
      .map((e) => `${titleOfId(e.from)} (${e.fromPin})`);
  const outgoing = (pin: string) =>
    def.edges.filter((e) => e.from === node.id && e.fromPin === pin).map((e) => titleOfId(e.to));
  const isStart = node.type === ENTRY_TYPE;
  const boundary = isStart || node.type === RETURN_TYPE;
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
  const inputs = signature?.inputs ?? [];
  const outputs = signature?.outputs ?? [];
  const exits = signature?.execOut ?? [];

  return (
    <aside aria-labelledby={titleId} className="flex min-h-0 flex-1 flex-col">
      <header className="border-border flex items-start justify-between gap-4 border-b p-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={titleId} className="text-base font-bold">
            {catalog.titleOf(node)}
          </h2>
          <p className="text-surface-fg-muted text-sm">{catalog.describe(node)}</p>
          {onOpen ? (
            <div className="pt-2">
              <Button variant="outline" onClick={onOpen}>
                <ExternalLinkIcon aria-hidden="true" className="size-4" />
                Open {catalog.opensAs(node) === 'graph' ? 'Subworkflow' : 'Workflow'}
              </Button>
            </div>
          ) : null}
        </div>
        <IconButton label="Close" icon={XIcon} tooltipSide="left" onClick={onClose} />
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
        {inputs.length ? (
          <SectionPanel
            title="Inputs"
            description={
              editable
                ? 'What this node needs. Connect a pin on the canvas, or set a value here.'
                : 'What this node needs, and where each value comes from.'
            }
          >
            <ul className="flex flex-col gap-3">
              {inputs.map((spec) => {
                const from = incoming(spec.name);
                return from.length ? (
                  <li
                    key={spec.name}
                    className="border-border flex flex-col gap-1 rounded-xl border p-4"
                  >
                    <PinHeading spec={spec} />
                    <span className="text-sm">From {from.join(', ')}</span>
                  </li>
                ) : (
                  <BindingEditor
                    key={`${node.id}-${spec.name}`}
                    nodeId={node.id}
                    spec={spec}
                    binding={node.inputs?.[spec.name]}
                    editable={editable}
                    onBind={(binding) => bind(spec.name, binding)}
                  />
                );
              })}
            </ul>
          </SectionPanel>
        ) : null}
        {outputs.length ? (
          <SectionPanel
            title="Outputs"
            description="What this node produces for the nodes after it."
          >
            <ul className="flex flex-col gap-2">
              {outputs.map((spec) => (
                <li key={spec.name} className="flex flex-col gap-0.5">
                  <PinHeading spec={spec} />
                  <Links items={outgoing(spec.name)} empty="Not used yet" />
                </li>
              ))}
            </ul>
          </SectionPanel>
        ) : null}
        {exits.length ? (
          <SectionPanel
            title="Then"
            description="Where the run goes next, each path a separate connection on the canvas."
          >
            <ul className="flex flex-col gap-2">
              {exits.map((pin) => (
                <li key={pin} className="flex flex-wrap justify-between gap-x-3">
                  <span className="text-sm font-semibold">{pin === 'exec' ? 'Next' : pin}</span>
                  <Links items={outgoing(pin)} empty="Not connected" />
                </li>
              ))}
            </ul>
          </SectionPanel>
        ) : null}
        {!boundary && catalog.hasConfig(node) ? (
          <SectionPanel title="Settings" description="How this node is set up, beyond its inputs.">
            {Object.hasOwn(TABLE_EDITORS, node.type) ? (
              (() => {
                const TableEditor = TABLE_EDITORS[node.type as keyof typeof TABLE_EDITORS];
                return (
                  <TableEditor
                    nodeId={node.id}
                    config={node.config}
                    editable={editable}
                    onConfig={(config) => set({ config })}
                  />
                );
              })()
            ) : (
              <ConfigEditor
                key={node.id}
                node={node}
                editable={editable}
                onConfig={(config) => set({ config })}
              />
            )}
          </SectionPanel>
        ) : null}
        {editable ? (
          <SectionPanel
            title="Name"
            description="Shown on the canvas instead of the node's usual name."
          >
            <Input
              id={`${node.id}-label`}
              label="Label"
              placeholder={catalog.titleOf({ id: node.id, type: node.type, version: node.version })}
              value={node.label ?? ''}
              onChange={(e) => set({ label: e.target.value || undefined })}
            />
          </SectionPanel>
        ) : null}
        {signature && !isPure(signature) && !boundary ? (
          <SectionPanel
            title="Retry on Failure"
            description="Try this node again before stopping the run, waiting longer each time."
          >
            <fieldset disabled={!editable} className="grid grid-cols-2 gap-x-4 gap-y-5">
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
                      max > 0
                        ? {
                            max,
                            delayMs: node.retry?.delayMs ?? 1000,
                            factor: node.retry?.factor ?? 2
                          }
                        : undefined
                  });
                }}
              />
              <Input
                id={`${node.id}-retry-delay`}
                label="First Wait (ms)"
                type="number"
                min={0}
                disabled={!node.retry}
                value={node.retry?.delayMs ?? 1000}
                onChange={(e) =>
                  node.retry && set({ retry: { ...node.retry, delayMs: Number(e.target.value) } })
                }
              />
            </fieldset>
          </SectionPanel>
        ) : null}
        {editable && !isStart ? (
          <div className="border-border border-t pt-5">
            <Button intent="danger" variant="outline" onClick={onDelete}>
              <Trash2Icon aria-hidden="true" className="size-4" />
              Delete Node
            </Button>
          </div>
        ) : null}
      </div>
    </aside>
  );
};
