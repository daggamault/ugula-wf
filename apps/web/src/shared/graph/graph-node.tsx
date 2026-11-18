import {
  type ExitDoc,
  type InputBinding,
  isRecord,
  type NodeInstance,
  type PinSpec,
  type ValueKinds
} from '@ugula/graph';
import { Handle, type NodeProps, Position } from '@xyflow/react';
import { PlusIcon } from 'lucide-react';
import { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import { CodeLabel, coded } from '../claims/code-text.tsx';
import { classNamesOf } from '../class-names.ts';
import { labelFromName } from '../format.ts';
import { Badge } from '../ui/badge.tsx';
import { interactiveClasses } from '../ui/interactive.ts';
import { type NodeKind, OPENS_LABELS } from './catalog.ts';
import { useCodeMeanings } from './code-meanings.ts';
import { type GraphFlowNode, type NodeStatus, REROUTE } from './flow.ts';
import { describeType, pinLabel, toneOf, ValueKindsContext } from './pins.ts';

type Pin = { name: string; label: string; exec: boolean; spec?: PinSpec; doc?: ExitDoc };

type PinSide = 'in' | 'out';

type NodeActionsValue = {
  breakPin: (node: string, pin: string, side: PinSide) => void;
  revealPin: (node: string, pin: string) => void;
};

export const NodeActions = createContext<NodeActionsValue | null>(null);

const statusClasses: Record<NodeStatus, string> = {
  idle: 'border-border',
  done: 'border-success',
  error: 'border-danger',
  waiting: 'border-warning animate-pulse'
};

const KIND_CLASSES: Readonly<Record<NodeKind, string>> = {
  entry: 'border-t-node-entry bg-node-entry/15',
  action: 'border-t-node-action bg-node-action/15',
  pure: 'border-t-node-pure bg-node-pure/15',
  flow: 'border-t-node-flow bg-node-flow/15',
  human: 'border-t-node-human bg-node-human/15',
  table: 'border-t-node-table bg-node-table/15',
  call: 'border-t-node-call bg-node-call/15'
};

const handleBase = 'size-3! border-0! transition-transform hover:scale-125';
const execShape = 'rounded-none! [clip-path:polygon(0_0,100%_50%,0_100%)]';

const execLabel = (name: string, doc: ExitDoc | undefined) =>
  doc?.label ?? (name === 'exec' || name === 'then' ? '' : labelFromName(name));

const pinsOf = (
  exec: string[],
  data: PinSpec[],
  exits: Readonly<Record<string, ExitDoc>> = {}
): Pin[] => [
  ...exec.map((name) => {
    const doc = exits[name];
    return { name, label: execLabel(name, doc), exec: true, ...(doc ? { doc } : {}) };
  }),
  ...data.map((spec) => ({ name: spec.name, label: pinLabel(spec), exec: false, spec }))
];

export const pinTitle = (pin: Pin, kinds: ValueKinds) => {
  const head = pin.spec
    ? `${pin.label}: ${describeType(pin.spec.type, kinds)}`
    : pin.label
      ? `${pin.label}: Execution flow`
      : 'Execution flow';
  const about = pin.spec?.description ?? pin.doc?.description;
  return about ? `${head}. ${about}` : head;
};

const preview = (binding: InputBinding | undefined) => {
  if (!binding) return null;
  const text = 'expr' in binding ? `= ${binding.expr}` : JSON.stringify(binding.value);
  return text.length > 18 ? `${text.slice(0, 17)}…` : text;
};

const PinRow = ({
  node,
  pin,
  side,
  binding
}: {
  node: string;
  pin: Pin;
  side: PinSide;
  binding?: string | null;
}) => {
  const actions = useContext(NodeActions);
  const kinds = useContext(ValueKindsContext);
  return (
    <li
      className={classNamesOf(
        'text-surface-fg-muted relative flex min-h-6 items-center gap-2 text-xs',
        side === 'in' ? 'pr-2 pl-4' : 'justify-end pr-4 pl-2'
      )}
      title={pinTitle(pin, kinds)}
    >
      <Handle
        type={side === 'in' ? 'target' : 'source'}
        position={side === 'in' ? Position.Left : Position.Right}
        id={pin.name}
        onClick={actions ? (e) => e.altKey && actions.breakPin(node, pin.name, side) : undefined}
        className={classNamesOf(
          handleBase,
          pin.exec ? execShape : 'rounded-full!',
          toneOf(pin.exec ? 'exec' : (pin.spec?.type ?? 'any')).dot
        )}
      />
      <span className="truncate">{pin.label}</span>
      {binding ? (
        <span className="bg-surface-fg/6 text-surface-fg-muted truncate rounded-full px-1.5 font-mono text-xs">
          {binding}
        </span>
      ) : null}
    </li>
  );
};

export const fieldMatches = (pins: readonly Pin[], query: string) => {
  const q = query.trim().toLowerCase();
  return q ? pins.filter((p) => `${p.label} ${p.name}`.toLowerCase().includes(q)) : [...pins];
};

const AddField = ({ node, hidden }: { node: string; hidden: Pin[] }) => {
  const actions = useContext(NodeActions);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const listId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) searchRef.current?.focus();
    else if (wasOpen.current) triggerRef.current?.focus();
    wasOpen.current = open;
  }, [open]);
  if (!actions || !hidden.length) return null;
  const close = () => {
    setOpen(false);
    setQuery('');
  };
  const matches = fieldMatches(hidden, query);
  return open ? (
    <div className="nodrag nopan nowheel border-border flex flex-col gap-1 border-t p-2">
      <input
        ref={searchRef}
        type="search"
        aria-label="Find Field"
        aria-controls={listId}
        placeholder="Find a Field"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          const first = matches[0];
          if (e.key === 'Escape') close();
          else if (e.key === 'Enter' && first) {
            actions.revealPin(node, first.name);
            close();
          }
        }}
        className={classNamesOf(
          interactiveClasses,
          'bg-surface border-border h-8 rounded-lg border px-2 text-xs'
        )}
      />
      <ul id={listId} className="flex max-h-48 flex-col overflow-y-auto">
        {matches.map((p) => (
          <li key={p.name}>
            <button
              type="button"
              onClick={() => {
                actions.revealPin(node, p.name);
                close();
              }}
              className={classNamesOf(
                interactiveClasses,
                'hover:bg-surface-fg/6 w-full truncate rounded-lg px-2 py-1 text-left text-xs'
              )}
            >
              {p.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  ) : (
    <button
      ref={triggerRef}
      type="button"
      onClick={() => setOpen(true)}
      className={classNamesOf(
        interactiveClasses,
        'nodrag text-surface-fg-muted hover:bg-surface-fg/6 hover:text-surface-fg border-border flex w-full items-center gap-1 rounded-b-lg border-t px-3 py-1 text-xs'
      )}
    >
      <PlusIcon aria-hidden="true" className="size-3.5" />
      Add Field
    </button>
  );
};

const kindOf = (type: unknown): string | null =>
  isRecord(type) ? (typeof type.code === 'string' ? type.code : kindOf(type.list)) : null;

const COMPARES = new Set(['std.logic.equal', 'std.logic.not-equal']);

export const codedValuesOf = (inst: NodeInstance) => {
  const config = isRecord(inst.config) ? inst.config : {};
  const kind = kindOf(config.type);
  if (!kind) return null;
  const fixed = inst.inputs?.b;
  const values =
    inst.type === 'std.value'
      ? [config.value].flat()
      : COMPARES.has(inst.type) && fixed && 'value' in fixed
        ? [fixed.value]
        : [];
  const codes = values.filter((c): c is string => typeof c === 'string' && c !== '');
  return codes.length ? { kind, codes } : null;
};

const SHOWN_CODES = 6;

const CodeList = ({ kind, codes }: { kind: string; codes: string[] }) => {
  const meanings = useCodeMeanings(kind, codes);
  return (
    <ul
      aria-label="Codes"
      className="border-border flex flex-col gap-0.5 border-b px-3 py-1.5 text-xs contain-inline-size"
    >
      {codes.slice(0, SHOWN_CODES).map((code) => (
        <li key={code} className="truncate">
          <CodeLabel value={coded(meanings.get(code) ?? null, code)} isInline />
        </li>
      ))}
      {codes.length > SHOWN_CODES ? (
        <li className="text-surface-fg-muted">{`+${codes.length - SHOWN_CODES} more`}</li>
      ) : null}
    </ul>
  );
};

const CHANGE_TITLES = {
  added: 'Added in this copy',
  changed: 'Changed from the Base',
  overridden: 'Your agency overrides this'
} as const;

const borderOf = (status: NodeStatus, custom: boolean, ghost: boolean) =>
  ghost
    ? 'border-custom border-dashed opacity-60'
    : custom && status === 'idle'
      ? 'border-custom'
      : statusClasses[status];

const Knot = ({ data, selected }: NodeProps<GraphFlowNode>) => {
  const type = data.signature?.outputs[0]?.type ?? 'any';
  const dot = classNamesOf('size-2! min-w-0! min-h-0! border-0! rounded-full!', toneOf(type).dot);
  return (
    <div
      role="img"
      aria-label={data.title}
      title={data.title}
      className={classNamesOf(
        'relative size-4 cursor-pointer rounded-full border-2',
        toneOf(type).dot,
        selected ? 'border-primary' : 'border-surface'
      )}
    >
      <Handle type="target" position={Position.Left} id="value" className={dot} />
      <Handle type="source" position={Position.Right} id="value" className={dot} />
    </div>
  );
};

export const GraphNode = (props: NodeProps<GraphFlowNode>) => {
  const { id, data, selected } = props;
  const { instance, signature, title, description, summary, status, issues, opens } = data;
  const { connected, change, ghost, kind, fold, exits } = data;
  if (instance.type === REROUTE.type && !ghost) return <Knot {...props} />;
  const shownOn = (side: PinSide, pins: Pin[]) =>
    fold?.side === side ? pins.filter((p) => p.exec || fold.shown.includes(p.name)) : pins;
  const allInputs = signature ? pinsOf(signature.execIn, signature.inputs) : [];
  const allOutputs = signature ? pinsOf(signature.execOut, signature.outputs, exits) : [];
  const inputs = shownOn('in', allInputs);
  const outputs = shownOn('out', allOutputs);
  const hidden = fold
    ? (fold.side === 'in' ? allInputs : allOutputs).filter(
        (p) => !p.exec && !fold.shown.includes(p.name)
      )
    : [];
  const pure = kind === 'pure';
  const codedValues = codedValuesOf(instance);
  const shownSummary = codedValues && instance.type === 'std.value' ? null : summary;
  return (
    <article
      aria-label={ghost ? `${title} (removed)` : title}
      className={classNamesOf(
        'bg-surface text-surface-fg w-max max-w-80 min-w-60 rounded-xl border-2 text-left transition duration-150 ease-out',
        ghost ? 'pointer-events-none' : 'cursor-pointer',
        borderOf(status, change !== null, ghost),
        selected && 'ring-primary ring-2'
      )}
    >
      <header
        title={description || undefined}
        className={classNamesOf(
          'border-border flex flex-col gap-0.5 rounded-t-lg border-t-4 border-b px-3 py-1.5',
          KIND_CLASSES[kind]
        )}
      >
        <span className="flex items-center justify-between gap-3">
          <span className="truncate text-sm font-semibold">{title}</span>
          <span className="flex shrink-0 items-center gap-1.5">
            {change || ghost ? (
              <span title={ghost ? 'Removed from the base' : CHANGE_TITLES[change ?? 'changed']}>
                <Badge intent="custom">{ghost ? 'Removed' : 'Custom'}</Badge>
              </span>
            ) : null}
            {opens ? (
              <span className="text-primary text-xs font-semibold tracking-wide uppercase">
                {OPENS_LABELS[opens]}
              </span>
            ) : null}
          </span>
        </span>
        {shownSummary ? (
          <span className="text-surface-fg-muted truncate text-xs contain-inline-size">
            {shownSummary}
          </span>
        ) : description && !pure ? (
          <span className="text-surface-fg-muted line-clamp-2 text-xs contain-inline-size">
            {description}
          </span>
        ) : null}
      </header>
      {codedValues ? <CodeList {...codedValues} /> : null}
      {instance.note ? (
        <p className="border-border bg-surface-fg/6 text-surface-fg line-clamp-3 border-b px-3 py-1.5 text-xs whitespace-pre-line contain-inline-size">
          {instance.note}
        </p>
      ) : null}
      {signature ? (
        <div className="grid grid-cols-2 gap-x-2 py-1.5">
          <ul className="flex flex-col">
            {inputs.map((pin) => (
              <PinRow
                key={pin.name}
                node={id}
                pin={pin}
                side="in"
                binding={
                  connected.includes(pin.name) || (codedValues && pin.name === 'b')
                    ? null
                    : preview(instance.inputs?.[pin.name])
                }
              />
            ))}
          </ul>
          <ul className="flex flex-col">
            {outputs.map((pin) => (
              <PinRow key={pin.name} node={id} pin={pin} side="out" />
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-danger px-3 py-2 text-xs">
          Unknown node {instance.type}@{instance.version}
        </p>
      )}
      {ghost ? null : <AddField node={id} hidden={hidden} />}
      {issues.length ? (
        <footer className="border-danger/30 text-danger border-t px-3 py-1 text-xs">
          {issues[0]}
          {issues.length > 1 ? ` (+${issues.length - 1})` : ''}
        </footer>
      ) : null}
    </article>
  );
};
