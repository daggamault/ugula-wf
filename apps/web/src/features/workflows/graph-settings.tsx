import {
  checkValue,
  formatType,
  type GraphDef,
  type PinSpec,
  parseType,
  type ValueType,
  type VariableDef
} from '@ugula/graph';
import { PlusIcon, Trash2Icon, XIcon } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { withSignature } from '../../shared/graph/flow.ts';
import { Button } from '../../shared/ui/button.tsx';
import { FieldGrid } from '../../shared/ui/field.tsx';
import { IconButton } from '../../shared/ui/icon-button.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { ValueField } from '../../shared/ui/value-field.tsx';
import type { GraphKind } from './client.ts';

type GraphSettingsProps = {
  kind: GraphKind;
  def: GraphDef;
  editable: boolean;
  onChange: (def: GraphDef) => void;
  onClose: () => void;
};

const rowClass =
  'grid grid-cols-1 items-start gap-x-4 gap-y-5 sm:grid-cols-[1fr_1fr_auto] sm:items-end';

const names = (text: string) =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const AddButton = ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
  <div>
    <Button variant="outline" onClick={onClick}>
      <PlusIcon aria-hidden="true" className="size-4" />
      {children}
    </Button>
  </div>
);

const RemoveButton = ({ name, onClick }: { name: string; onClick: () => void }) => (
  <IconButton
    label={`Remove ${name}`}
    tooltip="Remove"
    icon={Trash2Icon}
    intent="danger"
    onClick={onClick}
  />
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
    <SectionPanel title={title} description={description}>
      {pins.map((pin, i) => (
        <div key={`${id}-${i}`} className={rowClass}>
          <Input
            id={`${id}-${i}-name`}
            label="Name"
            value={pin.name}
            onChange={(e) => patch(i, { name: e.target.value })}
          />
          <TypeInput
            key={formatType(pin.type)}
            id={`${id}-${i}-type`}
            type={pin.type}
            onType={(type) => patch(i, { type })}
          />
          {editable ? (
            <RemoveButton name={pin.name} onClick={() => onPins(pins.filter((_, j) => j !== i))} />
          ) : null}
        </div>
      ))}
      {editable ? (
        <AddButton
          onClick={() => onPins([...pins, { name: `value${pins.length + 1}`, type: 'any' }])}
        >
          Add {noun.charAt(0).toUpperCase() + noun.slice(1)}
        </AddButton>
      ) : null}
    </SectionPanel>
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
    <SectionPanel
      title="Variables"
      description="Values kept while it runs, read and changed with Get and Set nodes."
    >
      {variables.map((variable, i) => (
        <div key={`var-${i}`} className="border-border flex flex-col gap-4 rounded-xl border p-4">
          <div className={rowClass}>
            <Input
              id={`var-${i}-name`}
              label="Name"
              value={variable.name}
              onChange={(e) => patch(i, { name: e.target.value })}
            />
            <TypeInput
              key={formatType(variable.type)}
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
            label="Starts As"
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
          Add Variable
        </AddButton>
      ) : null}
    </SectionPanel>
  );
};

export const GraphSettings = ({ kind, def, editable, onChange, onClose }: GraphSettingsProps) => {
  const titleId = useId();
  const { signature } = def;
  const setSignature = (patch: Partial<GraphDef['signature']>) =>
    onChange(withSignature(def, { signature: { ...signature, ...patch } }));
  return (
    <aside aria-labelledby={titleId} className="flex min-h-0 flex-1 flex-col">
      <header className="border-border flex items-start justify-between gap-4 border-b p-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={titleId} className="text-base font-bold">
            {kind === 'workflow' ? 'Workflow Settings' : 'Subworkflow Settings'}
          </h2>
          <p className="text-surface-fg-muted text-sm">
            What this takes in, hands back and keeps while it runs, shown as its node's pins.
          </p>
        </div>
        <IconButton
          label="Close Settings"
          tooltip="Close"
          icon={XIcon}
          tooltipSide="left"
          onClick={onClose}
        />
      </header>
      <fieldset
        disabled={!editable}
        className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4"
      >
        <SectionPanel title="Paths" description="Named ways in and out, and most have one of each.">
          <FieldGrid>
            <Input
              id="exec-in"
              span={2}
              label="Ways In"
              hint="Comma separated, for example: exec"
              defaultValue={signature.execIn.join(', ')}
              onBlur={(e) => setSignature({ execIn: names(e.target.value) })}
            />
            <Input
              id="exec-out"
              span={2}
              label="Ways Out"
              hint="Comma separated, for example: approved, rejected"
              defaultValue={signature.execOut.join(', ')}
              onBlur={(e) => setSignature({ execOut: names(e.target.value) })}
            />
          </FieldGrid>
        </SectionPanel>
        <PinsEditor
          id="in"
          title="Inputs"
          description="Values passed in when it starts, typed like string, number, list<string> or object{id: string}."
          noun="input"
          editable={editable}
          pins={signature.inputs}
          onPins={(inputs) => setSignature({ inputs })}
        />
        <PinsEditor
          id="out"
          title="Outputs"
          description="Values it hands back when it finishes."
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
    </aside>
  );
};
