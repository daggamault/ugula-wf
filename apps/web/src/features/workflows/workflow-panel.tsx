import {
  checkValue,
  type ExitDoc,
  type GraphDef,
  type PinSpec,
  type VariableDef
} from '@ugula/graph';
import { PlusIcon, XIcon } from 'lucide-react';
import { useId } from 'react';
import { withSignature } from '../../shared/graph/flow.ts';
import { freeFieldName, TypePicker } from '../../shared/graph/type-picker.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { Checkbox } from '../../shared/ui/checkbox.tsx';
import { FieldGrid } from '../../shared/ui/field.tsx';
import { IconButton } from '../../shared/ui/icon-button.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { ListRows } from '../../shared/ui/list-rows.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { ValueField } from '../../shared/ui/value-field.tsx';
import type { GraphKind } from './client.ts';

export type VariableNode = 'get' | 'set';

type WorkflowPanelProps = {
  kind: GraphKind;
  def: GraphDef;
  editable: boolean;
  locked: string | null;
  onChange: (def: GraphDef) => void;
  onVariableNode?: ((name: string, node: VariableNode) => void) | undefined;
  onClose: () => void;
};

type Doc = { label?: string | undefined; description?: string | undefined };

type Exit = Doc & { name: string };

export const withDoc = <T extends Doc>(doc: T, key: keyof Doc, text: string): T => {
  const { [key]: _, ...rest } = doc;
  return (text.trim() ? { ...rest, [key]: text } : rest) as T;
};

export const freeName = (prefix: string, taken: readonly string[]) => {
  let n = taken.length + 1;
  while (taken.includes(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
};

export const exitsOf = ({ execOut, exits = {} }: GraphDef['signature']): Exit[] =>
  execOut.map((name) => ({ name, ...exits[name] }));

export const withExits = (signature: GraphDef['signature'], exits: readonly Exit[]) => {
  const docs = exits.flatMap(({ name, label, description }): [string, ExitDoc][] =>
    label || description
      ? [[name, { ...(label ? { label } : {}), ...(description ? { description } : {}) }]]
      : []
  );
  const { exits: _, ...rest } = signature;
  return {
    ...rest,
    execOut: exits.map((e) => e.name),
    ...(docs.length ? { exits: Object.fromEntries(docs) } : {})
  };
};

const DocFields = ({
  id,
  doc,
  onDoc
}: {
  id: string;
  doc: Doc;
  onDoc: (key: keyof Doc, text: string) => void;
}) => (
  <FieldGrid>
    <Input
      id={`${id}-label`}
      label="Label"
      hint="Title Case, shown on the pin."
      value={doc.label ?? ''}
      onChange={(e) => onDoc('label', e.target.value)}
    />
    <Input
      id={`${id}-description`}
      label="Description"
      hint="One sentence on what it means."
      value={doc.description ?? ''}
      onChange={(e) => onDoc('description', e.target.value)}
    />
  </FieldGrid>
);

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
}) => (
  <SectionPanel title={title} description={description}>
    <ListRows
      id={id}
      noun={noun}
      items={pins}
      editable={editable}
      blank={(): PinSpec => ({
        name: freeFieldName(pins.map((p) => p.name)),
        type: 'string'
      })}
      nameOf={(pin) => pin.name}
      onChange={onPins}
    >
      {(pin, i, set) => (
        <div className="border-border flex flex-col gap-4 rounded-xl border p-4">
          <FieldGrid>
            <Input
              id={`${id}-${i}-name`}
              label="Name"
              isMonospace
              value={pin.name}
              onChange={(e) => set({ ...pin, name: e.target.value })}
            />
            <TypePicker
              id={`${id}-${i}-type`}
              label="Type"
              value={pin.type}
              editable={editable}
              onChange={(type) => set({ ...pin, type })}
            />
          </FieldGrid>
          <DocFields
            id={`${id}-${i}`}
            doc={pin}
            onDoc={(key, text) => set(withDoc(pin, key, text))}
          />
        </div>
      )}
    </ListRows>
  </SectionPanel>
);

const ExitsEditor = ({
  editable,
  exits,
  onExits
}: {
  editable: boolean;
  exits: readonly Exit[];
  onExits: (exits: Exit[]) => void;
}) => (
  <SectionPanel title="Exits" description="The ways it can finish, each its own pin on its node.">
    <ListRows
      id="exit"
      noun="Exit"
      items={exits}
      editable={editable}
      blank={(): Exit => ({
        name: freeName(
          'exit',
          exits.map((e) => e.name)
        )
      })}
      nameOf={(exit) => exit.name}
      onChange={onExits}
    >
      {(exit, i, set) => (
        <div className="border-border flex flex-col gap-4 rounded-xl border p-4">
          <Input
            id={`exit-${i}-name`}
            label="Name"
            isMonospace
            value={exit.name}
            onChange={(e) => set({ ...exit, name: e.target.value })}
          />
          <DocFields
            id={`exit-${i}`}
            doc={exit}
            onDoc={(key, text) => set(withDoc(exit, key, text))}
          />
        </div>
      )}
    </ListRows>
  </SectionPanel>
);

const VariablesEditor = ({
  editable,
  variables,
  onVariables,
  onVariableNode
}: {
  editable: boolean;
  variables: readonly VariableDef[];
  onVariables: (variables: VariableDef[]) => void;
  onVariableNode?: ((name: string, node: VariableNode) => void) | undefined;
}) => (
  <SectionPanel
    title="Variables"
    description="Values kept while it runs, read and changed with Get and Set nodes."
  >
    <ListRows
      id="var"
      noun="Variable"
      items={variables}
      editable={editable}
      blank={(): VariableDef => ({
        name: freeName(
          'var',
          variables.map((v) => v.name)
        ),
        type: 'number',
        default: 0
      })}
      nameOf={(variable) => variable.name}
      onChange={onVariables}
    >
      {(variable, i, set) => (
        <div className="border-border flex flex-col gap-4 rounded-xl border p-4">
          <FieldGrid>
            <Input
              id={`var-${i}-name`}
              label="Name"
              isMonospace
              value={variable.name}
              onChange={(e) => set({ ...variable, name: e.target.value })}
            />
            <TypePicker
              id={`var-${i}-type`}
              label="Type"
              value={variable.type}
              editable={editable}
              onChange={(type) =>
                set({
                  ...variable,
                  type,
                  default: checkValue(type, variable.default) ? null : variable.default
                })
              }
            />
          </FieldGrid>
          <ValueField
            id={`var-${i}-default`}
            label="Starts As"
            type={variable.type}
            value={variable.default}
            onChange={(value) => set({ ...variable, default: value })}
          />
          {editable && onVariableNode ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onVariableNode(variable.name, 'get')}
              >
                <PlusIcon aria-hidden="true" className="size-4" />
                Add Get {variable.name}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onVariableNode(variable.name, 'set')}
              >
                <PlusIcon aria-hidden="true" className="size-4" />
                Add Set {variable.name}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </ListRows>
  </SectionPanel>
);

export const WorkflowPanel = ({
  kind,
  def,
  editable,
  locked,
  onChange,
  onVariableNode,
  onClose
}: WorkflowPanelProps) => {
  const titleId = useId();
  const { signature } = def;
  const noun = kind === 'workflow' ? 'workflow' : 'subworkflow';
  const setSignature = (next: GraphDef['signature']) =>
    onChange(withSignature(def, { signature: next }));
  return (
    <aside aria-labelledby={titleId} className="flex min-h-0 flex-1 flex-col">
      <header className="border-border flex items-start justify-between gap-4 border-b p-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={titleId} className="text-base font-bold">
            Inputs and Outputs
          </h2>
          <p className="text-surface-fg-muted text-sm">
            {locked ??
              `What this ${noun} takes in, hands back and keeps while it runs, shown as its node's pins.`}
          </p>
        </div>
        <IconButton
          label="Close Inputs and Outputs"
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
        <label htmlFor="exec-in" className="flex items-center gap-2 text-sm font-medium">
          <Checkbox
            id="exec-in"
            checked={signature.execIn.length > 0}
            onChange={(e) =>
              setSignature({ ...signature, execIn: e.target.checked ? ['exec'] : [] })
            }
          />
          Runs as a Step
        </label>
        <PinsEditor
          id="in"
          title="Inputs"
          description="What it is given when it starts."
          noun="Input"
          editable={editable}
          pins={signature.inputs}
          onPins={(inputs) => setSignature({ ...signature, inputs })}
        />
        <PinsEditor
          id="out"
          title="Outputs"
          description="What it hands back when it finishes."
          noun="Output"
          editable={editable}
          pins={signature.outputs}
          onPins={(outputs) => setSignature({ ...signature, outputs })}
        />
        <ExitsEditor
          editable={editable}
          exits={exitsOf(signature)}
          onExits={(exits) => setSignature(withExits(signature, exits))}
        />
        <VariablesEditor
          editable={editable}
          variables={def.variables}
          onVariables={(variables) => onChange(withSignature(def, { variables }))}
          onVariableNode={onVariableNode}
        />
      </fieldset>
    </aside>
  );
};
