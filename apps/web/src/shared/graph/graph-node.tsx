import type { ExitDoc, InputBinding, PinSpec } from '@ugula/graph';
import { Handle, type NodeProps, Position } from '@xyflow/react';
import { classNamesOf } from '../class-names.ts';
import { labelFromName } from '../format.ts';
import { Badge } from '../ui/badge.tsx';
import type { GraphFlowNode, NodeStatus } from './flow.ts';
import { describeType, pinLabel, toneOf } from './pins.ts';

type Pin = { name: string; label: string; exec: boolean; spec?: PinSpec; doc?: ExitDoc };

const statusClasses: Record<NodeStatus, string> = {
  idle: 'border-border',
  done: 'border-success',
  error: 'border-danger',
  waiting: 'border-warning animate-pulse'
};

const handleBase = 'size-3! border-0! transition-transform hover:scale-125';
const execShape = 'rounded-none! [clip-path:polygon(0_0,100%_50%,0_100%)]';

const execLabel = (name: string, doc: ExitDoc | undefined) =>
  doc?.label ?? (name === 'exec' || name === 'then' ? '' : labelFromName(name));

const pinsOf = (exec: string[], data: PinSpec[], exits: Record<string, ExitDoc> = {}): Pin[] => [
  ...exec.map((name) => {
    const doc = exits[name];
    return { name, label: execLabel(name, doc), exec: true, ...(doc ? { doc } : {}) };
  }),
  ...data.map((spec) => ({ name: spec.name, label: pinLabel(spec), exec: false, spec }))
];

export const pinTitle = (pin: Pin) => {
  const head = pin.spec
    ? `${pin.label}: ${describeType(pin.spec.type)}`
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
  pin,
  side,
  binding
}: {
  pin: Pin;
  side: 'in' | 'out';
  binding?: string | null;
}) => (
  <li
    className={classNamesOf(
      'text-surface-fg-muted relative flex min-h-6 items-center gap-2 text-xs',
      side === 'in' ? 'pr-2 pl-4' : 'justify-end pr-4 pl-2'
    )}
    title={pinTitle(pin)}
  >
    <Handle
      type={side === 'in' ? 'target' : 'source'}
      position={side === 'in' ? Position.Left : Position.Right}
      id={pin.name}
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

const CHANGE_TITLES = {
  added: 'Added in this copy',
  changed: 'Changed from the base',
  overridden: 'Your organization or agency overrides this'
} as const;

const borderOf = (status: NodeStatus, custom: boolean, ghost: boolean) =>
  ghost
    ? 'border-custom border-dashed opacity-60'
    : custom && status === 'idle'
      ? 'border-custom'
      : statusClasses[status];

export const GraphNode = ({ data, selected }: NodeProps<GraphFlowNode>) => {
  const { instance, signature, title, description, status, issues, opens, connected } = data;
  const { change, ghost } = data;
  const inputs = signature ? pinsOf(signature.execIn, signature.inputs) : [];
  const outputs = signature ? pinsOf(signature.execOut, signature.outputs, signature.exits) : [];
  return (
    <article
      aria-label={ghost ? `${title} (removed)` : title}
      className={classNamesOf(
        'bg-surface text-surface-fg w-60 rounded-xl border-2 text-left transition duration-150 ease-out',
        ghost ? 'pointer-events-none' : 'cursor-pointer',
        borderOf(status, change !== null, ghost),
        selected && 'ring-primary ring-2'
      )}
    >
      <header className="border-border flex flex-col gap-0.5 border-b px-3 py-1.5">
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
                {opens === 'graph' ? 'Subworkflow' : 'Workflow'}
              </span>
            ) : null}
          </span>
        </span>
        {description ? (
          <span className="text-surface-fg-muted line-clamp-2 text-xs">{description}</span>
        ) : null}
      </header>
      {instance.note ? (
        <p className="border-border bg-surface-fg/6 text-surface-fg line-clamp-3 border-b px-3 py-1.5 text-xs whitespace-pre-line">
          {instance.note}
        </p>
      ) : null}
      {signature ? (
        <div className="grid grid-cols-2 gap-x-2 py-1.5">
          <ul className="flex flex-col">
            {inputs.map((pin) => (
              <PinRow
                key={pin.name}
                pin={pin}
                side="in"
                binding={connected.includes(pin.name) ? null : preview(instance.inputs?.[pin.name])}
              />
            ))}
          </ul>
          <ul className="flex flex-col">
            {outputs.map((pin) => (
              <PinRow key={pin.name} pin={pin} side="out" />
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-danger px-3 py-2 text-xs">
          Unknown node {instance.type}@{instance.version}
        </p>
      )}
      {issues.length ? (
        <footer className="border-danger/30 text-danger border-t px-3 py-1 text-xs">
          {issues[0]}
          {issues.length > 1 ? ` (+${issues.length - 1})` : ''}
        </footer>
      ) : null}
    </article>
  );
};
