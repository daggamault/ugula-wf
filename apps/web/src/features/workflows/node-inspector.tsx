import {
  ENTRY_TYPE,
  type GraphDef,
  type InputBinding,
  isPure,
  type Json,
  type NodeInstance,
  RETURN_TYPE,
  type Signature,
  tableRefOf
} from '@ugula/graph';
import { ExternalLinkIcon, RotateCcwIcon, Trash2Icon, XIcon } from 'lucide-react';
import { useId, useRef } from 'react';
import { labelFromName } from '../../shared/format.ts';
import { type Catalog, OPENS_LABELS } from '../../shared/graph/catalog.ts';
import { updateNode } from '../../shared/graph/flow.ts';
import { pinLabel } from '../../shared/graph/pins.ts';
import { Button } from '../../shared/ui/button.tsx';
import { Disclosure } from '../../shared/ui/disclosure.tsx';
import { IconButton } from '../../shared/ui/icon-button.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { Section, SectionPanel } from '../../shared/ui/section-panel.tsx';
import { Textarea } from '../../shared/ui/textarea.tsx';
import { BindingEditor, CustomDot, PinHeading } from './binding-editor.tsx';
import type { EffectiveTable } from './client.ts';
import { ConfigEditor, NodeSettings, TABLE_EDITORS, TableReference } from './node-settings.tsx';
import { formatBase, nodeChanges, propertyName, resetProperty } from './override-diff.ts';

type NodeInspectorProps = {
  def: GraphDef;
  node: NodeInstance;
  catalog: Catalog;
  editable: boolean;
  onChange: (def: GraphDef) => void;
  onDelete: () => void;
  onOpen?: (() => void) | undefined;
  onClose: () => void;
  base?: NodeInstance | undefined;
  table?: EffectiveTable | undefined;
};

export const secondsOf = (ms: number) => ms / 1000;

export const msOf = (seconds: number) => Math.max(0, Math.round(seconds * 1000));

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
  onClose,
  base,
  table
}: NodeInspectorProps) => {
  const titleId = useId();
  const lastSignature = useRef<Signature | null>(null);
  const current = catalog.signatureOf(node, def);
  if (current) lastSignature.current = current;
  const signature = current ?? lastSignature.current;
  const titleOfId = (id: string) => {
    const other = def.nodes.find((n) => n.id === id);
    return other ? catalog.titleOf(other) : id;
  };
  const outputLabel = (id: string, pin: string) => {
    const other = def.nodes.find((n) => n.id === id);
    const spec = other && catalog.signatureOf(other, def)?.outputs.find((o) => o.name === pin);
    return spec ? pinLabel(spec) : labelFromName(pin);
  };
  const incoming = (pin: string) =>
    def.edges
      .filter((e) => e.to === node.id && e.toPin === pin)
      .map((e) => `${titleOfId(e.from)} · ${outputLabel(e.from, e.fromPin)}`);
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
  const changes = base ? nodeChanges(base, node) : [];
  const changedPins = new Set(
    changes.flatMap((c) =>
      c.property.startsWith('input:') ? [c.property.slice('input:'.length)] : []
    )
  );
  const tableRef = tableRefOf(node);
  const inputs = signature?.inputs ?? [];
  const outputs = signature?.outputs ?? [];
  const exits = signature?.execOut ?? [];
  const exitDocs = catalog.exitsOf(node, def);
  const hasSettings = !boundary && catalog.hasConfig(node);
  const canRetry = signature !== null && !isPure(signature) && !boundary;
  const variables = def.variables.map((x) => x.name);
  const setConfig = (config: Json | undefined) => set({ config });

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
                Open {OPENS_LABELS[catalog.opensAs(node) ?? 'workflow']}
              </Button>
            </div>
          ) : null}
        </div>
        <IconButton label="Close" icon={XIcon} tooltipSide="left" onClick={onClose} />
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
        {base && changes.length ? (
          <SectionPanel title="Changed From Base">
            <ul className="flex flex-col gap-3">
              {changes.map((c) => (
                <li key={c.property} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      <CustomDot />
                      {labelFromName(propertyName(c.property))}
                    </span>
                    <span className="text-surface-fg-muted text-xs">
                      Base: {formatBase(c.base)}
                    </span>
                  </span>
                  {editable ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        onChange(updateNode(def, node.id, resetProperty(node, base, c.property)))
                      }
                    >
                      <RotateCcwIcon aria-hidden="true" className="size-4" />
                      Reset to Base
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </SectionPanel>
        ) : null}
        {inputs.length ? (
          <SectionPanel
            title="Inputs"
            description={editable ? 'Connect a pin on the canvas, or set a value here.' : undefined}
          >
            <ul className="flex flex-col gap-3">
              {inputs.map((spec) => {
                const from = incoming(spec.name);
                return from.length ? (
                  <li
                    key={spec.name}
                    className="border-border flex flex-col gap-1 rounded-xl border p-4"
                  >
                    <PinHeading spec={spec} changed={changedPins.has(spec.name)} />
                    <span className="text-sm">From {from.join(', ')}</span>
                  </li>
                ) : (
                  <BindingEditor
                    key={`${node.id}-${spec.name}`}
                    nodeId={node.id}
                    spec={spec}
                    binding={node.inputs?.[spec.name]}
                    editable={editable}
                    changed={changedPins.has(spec.name)}
                    variables={variables}
                    onBind={(binding) => bind(spec.name, binding)}
                  />
                );
              })}
            </ul>
          </SectionPanel>
        ) : null}
        {hasSettings ? (
          <SectionPanel title="Settings">
            {tableRef ? <TableReference tableKey={tableRef.key} table={table} /> : null}
            {tableRef && Object.hasOwn(TABLE_EDITORS, node.type) ? null : (
              <NodeSettings
                key={node.id}
                node={node}
                nodeId={node.id}
                config={node.config}
                editable={editable}
                onConfig={setConfig}
                def={def}
                catalog={catalog}
              />
            )}
          </SectionPanel>
        ) : null}
        {outputs.length ? (
          <SectionPanel title="Outputs">
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
          <SectionPanel title="Then">
            <ul className="flex flex-col gap-2">
              {exits.map((pin) => {
                const doc = exitDocs[pin];
                return (
                  <li key={pin} className="flex flex-col gap-0.5">
                    <span className="flex flex-wrap justify-between gap-x-3">
                      <span className="text-sm font-semibold">
                        {doc?.label ?? (pin === 'exec' ? 'Next' : labelFromName(pin))}
                      </span>
                      <Links items={outgoing(pin)} empty="Not connected" />
                    </span>
                    {doc?.description ? (
                      <span className="text-surface-fg-muted text-xs">{doc.description}</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </SectionPanel>
        ) : null}
        {editable ? (
          <Disclosure isPanel title="Rename and Note">
            <Input
              id={`${node.id}-label`}
              label="Label"
              placeholder={catalog.titleOf({ id: node.id, type: node.type, version: node.version })}
              value={node.label ?? ''}
              onChange={(e) => set({ label: e.target.value || undefined })}
            />
            <Textarea
              id={`${node.id}-note`}
              label="Note"
              hint="Why this node is here or what to check before changing it."
              value={node.note ?? ''}
              onChange={(e) => set({ note: e.target.value || undefined })}
            />
          </Disclosure>
        ) : node.note ? (
          <SectionPanel title="Note">
            <p className="text-sm whitespace-pre-line">{node.note}</p>
          </SectionPanel>
        ) : null}
        {canRetry || (hasSettings && !tableRef) ? (
          <Disclosure isPanel title="Advanced">
            {canRetry ? (
              <Section title="Retry on Failure" description="Each wait is longer than the last.">
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
                    label="First Wait (Seconds)"
                    type="number"
                    min={0}
                    step="any"
                    disabled={!node.retry}
                    value={secondsOf(node.retry?.delayMs ?? 1000)}
                    onChange={(e) =>
                      node.retry &&
                      set({ retry: { ...node.retry, delayMs: msOf(Number(e.target.value)) } })
                    }
                  />
                </fieldset>
              </Section>
            ) : null}
            {hasSettings && !tableRef ? (
              <Disclosure title="Edit Settings as JSON">
                <ConfigEditor node={node} editable={editable} onConfig={setConfig} />
              </Disclosure>
            ) : null}
          </Disclosure>
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
