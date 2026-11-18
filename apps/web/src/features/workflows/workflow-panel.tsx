import { checkValue, type GraphDef, type Json, type PinSpec, type VariableDef } from '@ugula/graph';
import { PlusIcon, XIcon } from 'lucide-react';
import { type ReactNode, useContext, useEffect, useId, useState } from 'react';
import type { Catalog } from '../../shared/graph/catalog.ts';
import { withSignature } from '../../shared/graph/flow.ts';
import { pinLabel, WorkflowEventsContext } from '../../shared/graph/pins.ts';
import {
  dropUnfit,
  type Exit,
  eventSuggestions,
  exitsOf,
  keyFromName,
  nameExit,
  namePin,
  nameTaken,
  nameVariable,
  type PinSide,
  retypePin,
  setPins,
  setVariables,
  withExits
} from '../../shared/graph/signature-edits.ts';
import { TypePicker } from '../../shared/graph/type-picker.tsx';
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
  catalog: Catalog;
  editable: boolean;
  locked: string | null;
  onChange: (def: GraphDef) => void;
  onVariableNode?: ((name: string, node: VariableNode) => void) | undefined;
  onClose: () => void;
};

type Doc = { label?: string | undefined; description?: string | undefined };

export const withDoc = <T extends Doc>(doc: T, key: keyof Doc, text: string): T => {
  const { [key]: _, ...rest } = doc;
  return (text.trim() ? { ...rest, [key]: text } : rest) as T;
};

export const freeName = (prefix: string, taken: readonly string[]) => {
  let n = taken.length + 1;
  while (taken.includes(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
};

const tidy = (text: string) => text.trim().replace(/\s+/g, ' ');

const wiresNotice = (dropped: number) =>
  dropped
    ? `Disconnected ${dropped} ${dropped === 1 ? 'wire' : 'wires'} that no longer fit. Undo puts ${dropped === 1 ? 'it' : 'them'} back.`
    : null;

const NameField = ({
  id,
  value,
  taken,
  onCommit
}: {
  id: string;
  value: string;
  taken: (text: string) => boolean;
  onCommit: (text: string) => void;
}) => {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const error = !tidy(text)
    ? 'Give it a name.'
    : taken(text)
      ? 'Another one already has this name.'
      : undefined;
  const commit = () => {
    if (error || tidy(text) === value) setText(value);
    else onCommit(text);
  };
  return (
    <Input
      id={id}
      label="Name"
      value={text}
      error={error}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setText(value);
      }}
    />
  );
};

const DescriptionField = ({
  id,
  doc,
  onDoc
}: {
  id: string;
  doc: Doc;
  onDoc: (text: string) => void;
}) => (
  <Input
    id={`${id}-description`}
    label="Description"
    hint="One sentence on what it means. Shown when hovering the pin."
    value={doc.description ?? ''}
    onChange={(e) => onDoc(e.target.value)}
  />
);

const Notice = ({ children }: { children: ReactNode }) => (
  <p role="status" className="text-warning-text text-xs">
    {children}
  </p>
);

const withPins = (def: GraphDef, side: PinSide, pins: PinSpec[]) =>
  withSignature(def, { signature: { ...def.signature, [side]: pins } });

const isRequired = (pin: PinSpec) => !pin.optional && pin.default === undefined;

const RequiredFields = ({
  id,
  pin,
  onPin
}: {
  id: string;
  pin: PinSpec;
  onPin: (pin: PinSpec) => void;
}) => {
  const { optional: _, default: __, ...required } = pin;
  return (
    <div className="flex flex-col gap-3">
      <label htmlFor={`${id}-required`} className="flex items-center gap-2 text-sm font-medium">
        <Checkbox
          id={`${id}-required`}
          checked={isRequired(pin)}
          onChange={(e) => onPin(e.target.checked ? required : { ...required, optional: true })}
        />
        Required
      </label>
      {isRequired(pin) ? null : (
        <ValueField
          id={`${id}-default`}
          label="When Not Given"
          type={pin.type}
          value={pin.default ?? null}
          onChange={(value: Json) =>
            onPin(
              value === null || value === ''
                ? { ...required, optional: true }
                : { ...required, optional: true, default: value }
            )
          }
        />
      )}
    </div>
  );
};

const PinsEditor = ({
  side,
  title,
  description,
  noun,
  def,
  catalog,
  editable,
  onChange
}: {
  side: PinSide;
  title: string;
  description: string;
  noun: string;
  def: GraphDef;
  catalog: Catalog;
  editable: boolean;
  onChange: (def: GraphDef) => void;
}) => {
  const events = useContext(WorkflowEventsContext);
  const [notice, setNotice] = useState<{ index: number; text: string } | null>(null);
  const pins = def.signature[side];
  const suggestions = side === 'inputs' && editable ? eventSuggestions(def, events) : [];
  const setPin = (index: number, pin: PinSpec) =>
    onChange(
      withPins(
        def,
        side,
        pins.map((p, i) => (i === index ? pin : p))
      )
    );
  return (
    <SectionPanel title={title} description={description}>
      <ListRows
        id={side}
        noun={noun}
        items={pins}
        editable={editable}
        blank={(): PinSpec => ({
          name: keyFromName(
            `new ${noun}`,
            pins.map((p) => p.name)
          ),
          type: 'string'
        })}
        nameOf={(pin) => pinLabel(pin)}
        onChange={(next) => {
          setNotice(null);
          onChange(setPins(def, catalog, side, next).def);
        }}
      >
        {(pin, i) => (
          <div className="border-border flex flex-col gap-4 rounded-xl border p-4">
            <FieldGrid>
              <NameField
                id={`${side}-${i}-name`}
                value={pinLabel(pin)}
                taken={(text) => nameTaken(pins, i, text)}
                onCommit={(text) => onChange(namePin(def, side, i, text, events))}
              />
              <TypePicker
                id={`${side}-${i}-type`}
                label="Type"
                value={pin.type}
                editable={editable}
                onChange={(type) => {
                  const { def: next, dropped } = retypePin(def, catalog, side, i, type);
                  const text = wiresNotice(dropped);
                  setNotice(text ? { index: i, text } : null);
                  onChange(next);
                }}
              />
            </FieldGrid>
            {notice?.index === i ? <Notice>{notice.text}</Notice> : null}
            <DescriptionField
              id={`${side}-${i}`}
              doc={pin}
              onDoc={(text) => setPin(i, withDoc(pin, 'description', text))}
            />
            {side === 'inputs' ? (
              <RequiredFields id={`${side}-${i}`} pin={pin} onPin={(next) => setPin(i, next)} />
            ) : null}
          </div>
        )}
      </ListRows>
      {suggestions.length ? (
        <div className="flex flex-col gap-2">
          <p className="text-surface-fg-muted text-xs">Take in from the event that starts it:</p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((field) => (
              <Button
                key={field.name}
                variant="outline"
                size="sm"
                onClick={() => onChange(withPins(def, side, [...pins, field]))}
              >
                <PlusIcon aria-hidden="true" className="size-4" />
                {pinLabel(field)}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </SectionPanel>
  );
};

const ExitsEditor = ({
  def,
  editable,
  onChange
}: {
  def: GraphDef;
  editable: boolean;
  onChange: (def: GraphDef) => void;
}) => {
  const exits = exitsOf(def.signature);
  const setExits = (next: readonly Exit[]) =>
    onChange(withSignature(def, { signature: withExits(def.signature, next) }));
  const labelOf = (exit: Exit) => pinLabel(exit);
  return (
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
        nameOf={labelOf}
        onChange={setExits}
      >
        {(exit, i, set) => (
          <div className="border-border flex flex-col gap-4 rounded-xl border p-4">
            <NameField
              id={`exit-${i}-name`}
              value={labelOf(exit)}
              taken={(text) =>
                exits.some(
                  (e, j) => j !== i && labelOf(e).toLowerCase() === tidy(text).toLowerCase()
                )
              }
              onCommit={(text) => onChange(nameExit(def, i, text))}
            />
            <DescriptionField
              id={`exit-${i}`}
              doc={exit}
              onDoc={(text) => set(withDoc(exit, 'description', text))}
            />
          </div>
        )}
      </ListRows>
    </SectionPanel>
  );
};

const VariablesEditor = ({
  def,
  catalog,
  editable,
  onChange,
  onVariableNode
}: {
  def: GraphDef;
  catalog: Catalog;
  editable: boolean;
  onChange: (def: GraphDef) => void;
  onVariableNode?: ((name: string, node: VariableNode) => void) | undefined;
}) => {
  const [notice, setNotice] = useState<{ index: number; text: string } | null>(null);
  const { variables } = def;
  const replaceVariables = (next: VariableDef[]) => onChange(setVariables(def, catalog, next).def);
  return (
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
          name: keyFromName(
            'new variable',
            variables.map((v) => v.name)
          ),
          type: 'number',
          default: 0
        })}
        nameOf={(variable) => pinLabel(variable)}
        onChange={(next) => {
          setNotice(null);
          replaceVariables(next);
        }}
      >
        {(variable, i, set) => (
          <div className="border-border flex flex-col gap-4 rounded-xl border p-4">
            <FieldGrid>
              <NameField
                id={`var-${i}-name`}
                value={pinLabel(variable)}
                taken={(text) =>
                  variables.some(
                    (v, j) => j !== i && pinLabel(v).toLowerCase() === tidy(text).toLowerCase()
                  )
                }
                onCommit={(text) => onChange(nameVariable(def, i, text))}
              />
              <TypePicker
                id={`var-${i}-type`}
                label="Type"
                value={variable.type}
                editable={editable}
                onChange={(type) => {
                  const next = variables.map((v, j) =>
                    j === i
                      ? { ...v, type, default: checkValue(type, v.default) ? null : v.default }
                      : v
                  );
                  const { def: pruned, dropped } = dropUnfit(
                    def,
                    withSignature(def, { variables: next }),
                    catalog
                  );
                  const text = wiresNotice(dropped);
                  setNotice(text ? { index: i, text } : null);
                  onChange(pruned);
                }}
              />
            </FieldGrid>
            {notice?.index === i ? <Notice>{notice.text}</Notice> : null}
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
                  Add Get {pinLabel(variable)}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onVariableNode(variable.name, 'set')}
                >
                  <PlusIcon aria-hidden="true" className="size-4" />
                  Add Set {pinLabel(variable)}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </ListRows>
    </SectionPanel>
  );
};

export const WorkflowPanel = ({
  kind,
  def,
  catalog,
  editable,
  locked,
  onChange,
  onVariableNode,
  onClose
}: WorkflowPanelProps) => {
  const titleId = useId();
  const { signature } = def;
  const noun = kind === 'workflow' ? 'workflow' : 'subworkflow';
  return (
    <aside aria-labelledby={titleId} className="flex min-h-0 flex-1 flex-col">
      <header className="border-border flex items-start justify-between gap-4 border-b p-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={titleId} className="text-base font-bold">
            Inputs and Outputs
          </h2>
          <p className="text-surface-fg-muted text-sm">
            {locked ??
              `What this ${noun} takes in, hands back and keeps while it runs, shown as its node's pins. Tip: drop a wire on Add Output on a Return node, or drag from Add Input on Entry, to add one straight from the canvas.`}
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
              onChange(
                dropUnfit(
                  def,
                  withSignature(def, {
                    signature: { ...signature, execIn: e.target.checked ? ['exec'] : [] }
                  }),
                  catalog
                ).def
              )
            }
          />
          Runs as a Step
        </label>
        <PinsEditor
          side="inputs"
          title="Inputs"
          description="What it is given when it starts."
          noun="Input"
          def={def}
          catalog={catalog}
          editable={editable}
          onChange={onChange}
        />
        <PinsEditor
          side="outputs"
          title="Outputs"
          description="What it hands back when it finishes."
          noun="Output"
          def={def}
          catalog={catalog}
          editable={editable}
          onChange={onChange}
        />
        <ExitsEditor def={def} editable={editable} onChange={onChange} />
        <VariablesEditor
          def={def}
          catalog={catalog}
          editable={editable}
          onChange={onChange}
          onVariableNode={onVariableNode}
        />
      </fieldset>
    </aside>
  );
};
