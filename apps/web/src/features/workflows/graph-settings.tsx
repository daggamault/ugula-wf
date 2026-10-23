import {
  checkValue,
  formatType,
  type GraphDef,
  type PinSpec,
  parseType,
  type ValueType,
  type VariableDef
} from '@ugula/graph';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { withSignature } from '../../shared/graph/flow.ts';
import { Button } from '../../shared/ui/button.tsx';
import { Dialog } from '../../shared/ui/dialog.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { ValueField } from '../../shared/ui/value-field.tsx';

export type GraphSettingsProps = {
  open: boolean;
  def: GraphDef;
  editable: boolean;
  onChange: (def: GraphDef) => void;
  onClose: () => void;
};

const rowClass = 'grid grid-cols-1 items-start gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end';

const names = (text: string) =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const Section = ({
  title,
  description,
  children
}: {
  title: string;
  description: string;
  children: ReactNode;
}) => (
  <section className="border-border flex flex-col gap-3 border-t pt-5 first:border-t-0 first:pt-0">
    <header className="flex flex-col gap-0.5">
      <h3 className="text-sm font-bold">{title}</h3>
      <p className="text-surface-fg-muted text-xs">{description}</p>
    </header>
    {children}
  </section>
);

const AddButton = ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
  <div>
    <Button variant="outline" onClick={onClick}>
      <PlusIcon aria-hidden="true" className="size-4" />
      {children}
    </Button>
  </div>
);

const RemoveButton = ({ name, onClick }: { name: string; onClick: () => void }) => (
  <Button intent="danger" variant="outline" aria-label={`Remove ${name}`} onClick={onClick}>
    <Trash2Icon aria-hidden="true" className="size-4" />
    Remove
  </Button>
);

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
  description,
  noun,
  editable,
  pins,
  onPins
}: {
  id: string;
  title: string;
  description: string;
  noun: string;
  editable: boolean;
  pins: readonly PinSpec[];
  onPins: (pins: PinSpec[]) => void;
}) => {
  const patch = (i: number, next: Partial<PinSpec>) =>
    onPins(pins.map((p, j) => (j === i ? { ...p, ...next } : p)));
  return (
    <Section title={title} description={description}>
      {pins.map((pin, i) => (
        <div key={`${id}-${i}`} className={rowClass}>
          <Input
            id={`${id}-${i}-name`}
            label="Name"
            value={pin.name}
            onChange={(e) => patch(i, { name: e.target.value })}
          />
          <TypeInput id={`${id}-${i}-type`} type={pin.type} onType={(type) => patch(i, { type })} />
          {editable ? (
            <RemoveButton name={pin.name} onClick={() => onPins(pins.filter((_, j) => j !== i))} />
          ) : null}
        </div>
      ))}
      {editable ? (
        <AddButton
          onClick={() => onPins([...pins, { name: `value${pins.length + 1}`, type: 'any' }])}
        >
          Add {noun}
        </AddButton>
      ) : null}
    </Section>
  );
};

const VariablesEditor = ({
  editable,
  variables,
  onVariables
}: {
  editable: boolean;
  variables: readonly VariableDef[];
  onVariables: (variables: VariableDef[]) => void;
}) => {
  const patch = (i: number, next: Partial<VariableDef>) =>
    onVariables(variables.map((v, j) => (j === i ? { ...v, ...next } : v)));
  return (
    <Section
      title="Variables"
      description="Values the graph keeps while it runs. Read and change them with Get and Set nodes."
    >
      {variables.map((variable, i) => (
        <div key={`var-${i}`} className="border-border flex flex-col gap-2 rounded-lg border p-3">
          <div className={rowClass}>
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
            {editable ? (
              <RemoveButton
                name={variable.name}
                onClick={() => onVariables(variables.filter((_, j) => j !== i))}
              />
            ) : null}
          </div>
          <ValueField
            key={`var-${i}-${formatType(variable.type)}`}
            id={`var-${i}-default`}
            label="Starts as"
            type={variable.type}
            value={variable.default}
            onChange={(value) => patch(i, { default: value })}
          />
        </div>
      ))}
      {editable ? (
        <AddButton
          onClick={() =>
            onVariables([
              ...variables,
              { name: `var${variables.length + 1}`, type: 'number', default: 0 }
            ])
          }
        >
          Add variable
        </AddButton>
      ) : null}
    </Section>
  );
};

export const GraphSettings = ({ open, def, editable, onChange, onClose }: GraphSettingsProps) => {
  const { signature } = def;
  const setSignature = (patch: Partial<GraphDef['signature']>) =>
    onChange(withSignature(def, { signature: { ...signature, ...patch } }));
  return (
    <Dialog
      open={open}
      isWide
      title="Graph Settings"
      description="What this graph takes in, what it hands back, and what it keeps while it runs. Graphs that use this one see these as the pins of its node."
      onClose={onClose}
    >
      <fieldset
        disabled={!editable}
        className="flex max-h-[65dvh] flex-col gap-5 overflow-y-auto pr-1"
      >
        <Section
          title="Paths"
          description="Named ways into and out of the graph. Most graphs have one of each."
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              id="exec-in"
              label="Ways in"
              hint="Comma separated, for example: exec"
              defaultValue={signature.execIn.join(', ')}
              onBlur={(e) => setSignature({ execIn: names(e.target.value) })}
            />
            <Input
              id="exec-out"
              label="Ways out"
              hint="Comma separated, for example: approved, rejected"
              defaultValue={signature.execOut.join(', ')}
              onBlur={(e) => setSignature({ execOut: names(e.target.value) })}
            />
          </div>
        </Section>
        <PinsEditor
          id="in"
          title="Inputs"
          description="Values passed in when the graph starts. Types look like string, number, list<string> or object{id: string}."
          noun="input"
          editable={editable}
          pins={signature.inputs}
          onPins={(inputs) => setSignature({ inputs })}
        />
        <PinsEditor
          id="out"
          title="Outputs"
          description="Values the graph hands back when it finishes."
          noun="output"
          editable={editable}
          pins={signature.outputs}
          onPins={(outputs) => setSignature({ outputs })}
        />
        <VariablesEditor
          editable={editable}
          variables={def.variables}
          onVariables={(variables) => onChange(withSignature(def, { variables }))}
        />
      </fieldset>
    </Dialog>
  );
};
