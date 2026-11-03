import type { InputBinding, PinSpec } from '@ugula/graph';
import { Handle, type NodeProps, Position } from '@xyflow/react';
import { labelFromName } from '../format.ts';
import type { GraphFlowNode, NodeStatus } from './flow.ts';
import { describeType, pinLabel, toneOf } from './pins.ts';

type Pin = { name: string; label: string; exec: boolean; spec?: PinSpec };

const statusClasses: Record<NodeStatus, string> = {
  idle: 'border-border',
  done: 'border-success',
  error: 'border-danger',
  waiting: 'border-warning animate-pulse'
};

const handleBase = 'size-3! border-0! transition-transform hover:scale-125';
const execShape = 'rounded-none! [clip-path:polygon(0_0,100%_50%,0_100%)]';

const pinsOf = (exec: string[], data: PinSpec[]): Pin[] => [
  ...exec.map((name) => ({
    name,
    label: name === 'exec' || name === 'then' ? '' : labelFromName(name),
    exec: true
  })),
  ...data.map((spec) => ({ name: spec.name, label: pinLabel(spec), exec: false, spec }))
];

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
    className={`text-surface-fg-muted relative flex min-h-6 items-center gap-2 text-xs ${side === 'in' ? 'pr-2 pl-4' : 'justify-end pr-4 pl-2'}`}
    title={pin.spec ? `${pin.label}: ${describeType(pin.spec.type)}` : 'Execution flow'}
  >
    <Handle
      type={side === 'in' ? 'target' : 'source'}
      position={side === 'in' ? Position.Left : Position.Right}
      id={pin.name}
      className={`${handleBase} ${pin.exec ? execShape : 'rounded-full!'} ${toneOf(pin.exec ? 'exec' : (pin.spec?.type ?? 'any')).dot}`}
    />
    <span className="truncate">{pin.label}</span>
    {binding ? (
      <span className="bg-surface-fg/6 text-surface-fg-muted truncate rounded-full px-1.5 font-mono text-xs">
        {binding}
      </span>
    ) : null}
  </li>
);

export const GraphNode = ({ data, selected }: NodeProps<GraphFlowNode>) => {
  const { instance, signature, title, description, status, issues, opens, connected } = data;
  const inputs = signature ? pinsOf(signature.execIn, signature.inputs) : [];
  const outputs = signature ? pinsOf(signature.execOut, signature.outputs) : [];
  return (
    <article
      aria-label={title}
      className={`bg-surface text-surface-fg w-60 cursor-pointer rounded-xl border-2 text-left transition-shadow ${statusClasses[status]} ${selected ? 'ring-primary ring-2' : ''}`}
    >
      <header className="border-border flex flex-col gap-0.5 border-b px-3 py-1.5">
        <span className="flex items-center justify-between gap-3">
          <span className="truncate text-sm font-semibold">{title}</span>
          {opens ? (
            <span className="text-primary shrink-0 text-xs font-semibold tracking-wide uppercase">
              {opens === 'graph' ? 'Subworkflow' : 'Workflow'}
            </span>
          ) : null}
        </span>
        {description ? (
          <span className="text-surface-fg-muted line-clamp-2 text-xs">{description}</span>
        ) : null}
      </header>
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
