import type { InputBinding, Json, PinSpec } from '@ugula/graph';
import { describeType, pinLabel } from '../../shared/graph/pins.ts';
import { Input } from '../../shared/ui/input.tsx';
import { Select } from '../../shared/ui/select.tsx';
import { ValueField } from '../../shared/ui/value-field.tsx';

type BindingMode = 'default' | 'value' | 'expr';

const MODES = [
  { value: 'default', label: 'Not Set' },
  { value: 'value', label: 'A Fixed Value' },
  { value: 'expr', label: 'An Expression' }
] as const;

const modeOf = (binding: InputBinding | undefined): BindingMode =>
  !binding ? 'default' : 'expr' in binding ? 'expr' : 'value';

export const bindingFor = (
  mode: string,
  spec: Pick<PinSpec, 'default'>
): InputBinding | undefined =>
  mode === 'value' ? { value: spec.default ?? null } : mode === 'expr' ? { expr: '' } : undefined;

export const CustomDot = () => (
  <span
    role="img"
    aria-label="Changed from the base"
    title="Changed from the base"
    className="bg-custom size-2 shrink-0 rounded-full"
  />
);

export const PinHeading = ({ spec, changed = false }: { spec: PinSpec; changed?: boolean }) => (
  <span className="flex flex-col gap-0.5">
    <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <span className="flex items-center gap-2 text-sm font-semibold">
        {changed ? <CustomDot /> : null}
        {pinLabel(spec)}
      </span>
      <span className="text-surface-fg-muted text-xs">
        {describeType(spec.type)}
        {spec.optional ? ', optional' : ''}
      </span>
    </span>
    {spec.description ? (
      <span className="text-surface-fg-muted text-xs">{spec.description}</span>
    ) : null}
  </span>
);

const unsetText = (spec: PinSpec) =>
  spec.default !== undefined
    ? `Uses ${JSON.stringify(spec.default)} unless you set it.`
    : spec.optional
      ? 'Left empty unless you set it.'
      : 'Needs a value: connect a pin on the canvas, or set one here.';

export const BindingEditor = ({
  nodeId,
  spec,
  binding,
  editable,
  changed,
  onBind
}: {
  nodeId: string;
  spec: PinSpec;
  binding: InputBinding | undefined;
  editable: boolean;
  changed: boolean;
  onBind: (binding: InputBinding | undefined) => void;
}) => {
  const id = `${nodeId}-${spec.name}`;
  const mode = modeOf(binding);
  return (
    <li className="border-border flex flex-col gap-4 rounded-xl border p-4">
      <PinHeading spec={spec} changed={changed} />
      <fieldset disabled={!editable} className="flex flex-col gap-3">
        <Select
          id={`${id}-mode`}
          label="Value"
          options={MODES}
          value={mode}
          onChange={(e) => onBind(bindingFor(e.target.value, spec))}
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
