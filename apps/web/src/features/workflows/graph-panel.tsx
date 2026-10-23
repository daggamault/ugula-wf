import {
  checkValue,
  formatType,
  type GraphDef,
  type Issue,
  type PinSpec,
  parseType,
  type ValueType,
  type VariableDef
} from '@ugula/graph';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { withSignature } from '../../shared/graph/flow.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { IconButton } from '../../shared/ui/icon-button.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { ValueField } from '../../shared/ui/value-field.tsx';

export type GraphPanelProps = {
  def: GraphDef;
  issues: readonly Issue[];
  editable: boolean;
  onChange: (def: GraphDef) => void;
};

const headingClass = 'text-surface-fg-muted text-xs font-semibold tracking-wide uppercase';

const sectionClass = 'border-border flex flex-col gap-3 border-t pt-4';

const names = (text: string) =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const TypeInput = ({
  id,
  type,
  onType
}: {
  id: string;
  type: ValueType;
  onType: (type: ValueType) => void;
}) => {
  const [text, setText] = useState(formatType(type));
  const [error, setError] = useState<string>();
  return (
    <Input
      id={id}
      label="Type"
      isMonospace
      value={text}
      error={error}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        try {
          onType(parseType(text));
          setError(undefined);
        } catch (err) {
          setError(messageOf(err));
        }
      }}
    />
  );
};

const PinsEditor = ({
  id,
  title,
  pins,
  onPins
}: {
  id: string;
  title: string;
  pins: readonly PinSpec[];
  onPins: (pins: PinSpec[]) => void;
}) => {
  const patch = (i: number, next: Partial<PinSpec>) =>
    onPins(pins.map((p, j) => (j === i ? { ...p, ...next } : p)));
  return (
    <div className={sectionClass}>
      <h3 className={headingClass}>{title}</h3>
      {pins.map((pin, i) => (
        <div key={`${id}-${i}`} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
          <Input
            id={`${id}-${i}-name`}
            label="Name"
            value={pin.name}
            onChange={(e) => patch(i, { name: e.target.value })}
          />
          <TypeInput id={`${id}-${i}-type`} type={pin.type} onType={(type) => patch(i, { type })} />
          <IconButton
            label={`Remove ${pin.name}`}
            icon={Trash2Icon}
            intent="danger"
            onClick={() => onPins(pins.filter((_, j) => j !== i))}
          />
        </div>
      ))}
      <Button
        variant="outline"
        onClick={() => onPins([...pins, { name: `value${pins.length + 1}`, type: 'any' }])}
      >
        <PlusIcon aria-hidden="true" className="size-4" />
        Add {title.toLowerCase().replace(/s$/, '')}
      </Button>
    </div>
  );
};

const VariablesEditor = ({
  variables,
  onVariables
}: {
  variables: readonly VariableDef[];
  onVariables: (variables: VariableDef[]) => void;
}) => {
  const patch = (i: number, next: Partial<VariableDef>) =>
    onVariables(variables.map((v, j) => (j === i ? { ...v, ...next } : v)));
  return (
    <div className={sectionClass}>
      <h3 className={headingClass}>Variables</h3>
      {variables.map((variable, i) => (
        <fieldset
          key={`var-${i}`}
          className="border-border bg-canvas/50 flex flex-col gap-2 rounded-lg border p-3"
        >
          <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
            <Input
              id={`var-${i}-name`}
              label="Name"
              value={variable.name}
              onChange={(e) => patch(i, { name: e.target.value })}
            />
            <TypeInput
              id={`var-${i}-type`}
              type={variable.type}
              onType={(type) =>
                patch(i, {
                  type,
                  default: checkValue(type, variable.default) ? null : variable.default
                })
              }
            />
            <IconButton
              label={`Remove ${variable.name}`}
              icon={Trash2Icon}
              intent="danger"
              onClick={() => onVariables(variables.filter((_, j) => j !== i))}
            />
          </div>
          <ValueField
            key={`var-${i}-${formatType(variable.type)}`}
            id={`var-${i}-default`}
            label="Default"
            type={variable.type}
            value={variable.default}
            onChange={(value) => patch(i, { default: value })}
          />
        </fieldset>
      ))}
      <Button
        variant="outline"
        onClick={() =>
          onVariables([
            ...variables,
            { name: `var${variables.length + 1}`, type: 'number', default: 0 }
          ])
        }
      >
        <PlusIcon aria-hidden="true" className="size-4" />
        Add variable
      </Button>
    </div>
  );
};

export const GraphPanel = ({ def, issues, editable, onChange }: GraphPanelProps) => {
  const { signature } = def;
  const setSignature = (patch: Partial<GraphDef['signature']>) =>
    onChange(withSignature(def, { signature: { ...signature, ...patch } }));
  return (
    <section aria-labelledby="graph-panel-title" className="flex flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <h2 id="graph-panel-title" className="text-lg font-bold tracking-tight">
          Graph
        </h2>
        <p className="text-surface-fg-muted text-sm">
          Pins exposed when this graph runs or is used as a node. Select a node to edit it.
        </p>
      </header>
      {issues.map((issue) => (
        <Alert key={`${issue.node ?? ''}${issue.message}`} intent="warning">
          {issue.node ? `${issue.node}: ` : ''}
          {issue.message}
        </Alert>
      ))}
      <fieldset disabled={!editable} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Input
            id="exec-in"
            label="Exec inputs"
            hint="Comma separated"
            defaultValue={signature.execIn.join(', ')}
            onBlur={(e) => setSignature({ execIn: names(e.target.value) })}
          />
          <Input
            id="exec-out"
            label="Exec outputs"
            hint="Comma separated"
            defaultValue={signature.execOut.join(', ')}
            onBlur={(e) => setSignature({ execOut: names(e.target.value) })}
          />
        </div>
        <PinsEditor
          id="in"
          title="Inputs"
          pins={signature.inputs}
          onPins={(inputs) => setSignature({ inputs })}
        />
        <PinsEditor
          id="out"
          title="Outputs"
          pins={signature.outputs}
          onPins={(outputs) => setSignature({ outputs })}
        />
        <VariablesEditor
          variables={def.variables}
          onVariables={(variables) => onChange(withSignature(def, { variables }))}
        />
      </fieldset>
    </section>
  );
};
