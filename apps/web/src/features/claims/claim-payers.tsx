import {
  INSURED_RELATIONSHIPS,
  type InsuredRelationship,
  RELATIONSHIP_LABELS
} from '@ugula/billing';
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, SaveIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { classNamesOf } from '../../shared/class-names.ts';
import { titleCaseLabel } from '../../shared/format.ts';
import { Link } from '../../shared/router.tsx';
import { Alert } from '../../shared/ui/alert.tsx';
import { Badge } from '../../shared/ui/badge.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { EmptyText } from '../../shared/ui/empty-state.tsx';
import { FieldGrid } from '../../shared/ui/field.tsx';
import { IconButton, RemoveButton } from '../../shared/ui/icon-button.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { interactiveClasses } from '../../shared/ui/interactive.ts';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { Select } from '../../shared/ui/select.tsx';
import type { ClaimCoverage, PayerInput } from './client.ts';

export const moveItem = <T,>(items: readonly T[], from: number, to: number) => {
  if (to < 0 || to >= items.length) return [...items];
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
};

type PayerEntry = PayerInput & { id: string };

const SELF: InsuredRelationship = '18';

const RELATIONSHIP_OPTIONS = INSURED_RELATIONSHIPS.map((r) => ({
  value: r,
  label: titleCaseLabel(RELATIONSHIP_LABELS[r])
}));

const isRelationshipCode = (x: string): x is InsuredRelationship =>
  INSURED_RELATIONSHIPS.some((r) => r === x);

export const entryOf = (c: ClaimCoverage): PayerEntry => ({
  id: c.id,
  name: c.payer,
  relationship: c.relationship,
  insuredFirstName: c.insured_first_name,
  insuredLastName: c.insured_last_name
});

export const toPayerInput = ({ id, ...e }: PayerEntry): PayerInput =>
  e.relationship === SELF
    ? { ...e, insuredFirstName: null, insuredLastName: null }
    : {
        ...e,
        insuredFirstName: e.insuredFirstName?.trim() || null,
        insuredLastName: e.insuredLastName?.trim() || null
      };

export const payersErrorOf = (entries: readonly PayerEntry[]) => {
  const missing = entries.find((e) => {
    const input = toPayerInput(e);
    return input.relationship !== SELF && (!input.insuredFirstName || !input.insuredLastName);
  });
  return missing ? `Enter the insured's first and last name for ${missing.name}.` : undefined;
};

export const removeEntry = (entries: readonly PayerEntry[], id: string) =>
  entries.filter((e) => e.id !== id);

export const addEntry = (entries: readonly PayerEntry[], name: string, id: string) => {
  const trimmed = name.trim();
  const key = trimmed.toLowerCase();
  return !trimmed || entries.some((e) => e.name.toLowerCase() === key)
    ? [...entries]
    : [
        ...entries,
        {
          id,
          name: trimmed,
          relationship: SELF,
          insuredFirstName: null,
          insuredLastName: null
        }
      ];
};

export const PayersEditor = ({
  coverages,
  locked,
  onSave
}: {
  coverages: readonly ClaimCoverage[];
  locked: string | undefined;
  onSave: (payers: PayerInput[]) => Promise<void>;
}) => {
  const saved = JSON.stringify(coverages.map((c) => toPayerInput(entryOf(c))));
  const unlisted = new Set(
    coverages.filter((c) => c.payer_id === null).map((c) => c.payer.toLowerCase())
  );
  const [list, setList] = useState<PayerEntry[]>(() => coverages.map(entryOf));
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [isChecked, setChecked] = useState(false);
  const inputs = list.map(toPayerInput);
  const isDirty = JSON.stringify(inputs) !== saved;
  const problem = isChecked ? payersErrorOf(list) : undefined;
  const patch = (id: string, next: Partial<PayerEntry>) =>
    setList(list.map((e) => (e.id === id ? { ...e, ...next } : e)));
  const add = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setList(addEntry(list, name, crypto.randomUUID()));
    setName('');
  };
  const save = async () => {
    setChecked(true);
    if (payersErrorOf(list)) return;
    setBusy(true);
    await onSave(inputs);
    setBusy(false);
  };
  return (
    <SectionPanel
      title="Payers"
      description="Billed in this order, with the patient billed after the last payer."
      actions={
        <Button
          isPending={busy}
          disabledReason={locked ?? (isDirty ? undefined : 'No changes to save.')}
          onClick={() => void save()}
        >
          <SaveIcon aria-hidden="true" className="size-4" />
          Save Payers
        </Button>
      }
    >
      {list.length ? (
        <ol className="divide-border border-border flex flex-col divide-y rounded-xl border">
          {list.map(({ id, name: p, relationship, insuredFirstName, insuredLastName }, i) => (
            <li key={id} className="flex flex-col gap-4 px-4 py-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="bg-primary/10 text-primary min-w-5 shrink-0 rounded-full px-1.5 text-center text-xs/5 font-semibold tabular-nums"
                  >
                    {i + 1}
                  </span>
                  <span className="truncate font-medium">
                    <span className="sr-only">{i + 1}. </span>
                    {p}
                  </span>
                  {unlisted.has(p.toLowerCase()) ? (
                    <Link
                      to="/payers"
                      className={classNamesOf(
                        interactiveClasses,
                        'shrink-0 rounded-full hover:underline'
                      )}
                    >
                      <Badge intent="warning">Not in Payer Directory</Badge>
                    </Link>
                  ) : null}
                </span>
                <span className="flex items-center gap-1">
                  <IconButton
                    label={`Move ${p} up`}
                    tooltip="Move Up"
                    icon={ArrowUpIcon}
                    disabledReason={locked ?? (i === 0 ? 'Already first.' : undefined)}
                    onClick={() => setList(moveItem(list, i, i - 1))}
                  />
                  <IconButton
                    label={`Move ${p} down`}
                    tooltip="Move Down"
                    icon={ArrowDownIcon}
                    disabledReason={locked ?? (i === list.length - 1 ? 'Already last.' : undefined)}
                    onClick={() => setList(moveItem(list, i, i + 1))}
                  />
                  <RemoveButton
                    label={`Remove ${p}`}
                    disabledReason={locked}
                    onClick={() => setList(removeEntry(list, id))}
                  />
                </span>
              </div>
              <fieldset disabled={Boolean(locked)}>
                <FieldGrid>
                  <Select
                    id={`payer-${id}-relationship`}
                    label="Patient Is the Insured's"
                    span={relationship === SELF ? 4 : 2}
                    options={RELATIONSHIP_OPTIONS}
                    value={relationship}
                    onChange={(e) => {
                      if (isRelationshipCode(e.target.value)) {
                        patch(id, { relationship: e.target.value });
                      }
                    }}
                  />
                  {relationship === SELF ? null : (
                    <>
                      <Input
                        id={`payer-${id}-insured-first`}
                        label="Insured First Name"
                        required
                        error={problem && !insuredFirstName?.trim() ? 'Required' : undefined}
                        value={insuredFirstName ?? ''}
                        onChange={(e) => patch(id, { insuredFirstName: e.target.value })}
                      />
                      <Input
                        id={`payer-${id}-insured-last`}
                        label="Insured Last Name"
                        required
                        error={problem && !insuredLastName?.trim() ? 'Required' : undefined}
                        value={insuredLastName ?? ''}
                        onChange={(e) => patch(id, { insuredLastName: e.target.value })}
                      />
                    </>
                  )}
                </FieldGrid>
              </fieldset>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyText>No payers yet. The patient will be billed directly.</EmptyText>
      )}
      {problem ? <Alert>{problem}</Alert> : null}
      <form onSubmit={add} className="flex items-end gap-2" aria-label="Add payer">
        <fieldset disabled={Boolean(locked)} className="flex flex-1 items-end gap-2">
          <div className="flex-1">
            <Input
              id="payer-name"
              label="Add Payer"
              placeholder="Payer Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <Button type="submit" variant="outline">
            <PlusIcon aria-hidden="true" className="size-4" />
            Add
          </Button>
        </fieldset>
      </form>
    </SectionPanel>
  );
};
