import { FileClockIcon, SaveIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { FieldGrid, FormActions } from '../../shared/ui/field.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { Select } from '../../shared/ui/select.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { useResource } from '../../shared/use-resource.ts';
import type { ClaimDetail, ClaimsClient, FacilityOption, RecordsRequestInput } from './client.ts';

const NO_FACILITY = '';

export const facilityOptions = (
  facilities: readonly FacilityOption[],
  current: FacilityOption | null
) => [
  { value: NO_FACILITY, label: 'None: bill the payers and the patient' },
  ...(current && !facilities.some((f) => f.id === current.id) ? [current] : []).map((f) => ({
    value: f.id,
    label: f.name
  })),
  ...facilities.map((f) => ({ value: f.id, label: f.name }))
];

export const FacilityPanel = ({
  claim,
  findFacilities,
  locked,
  onSave
}: {
  claim: Pick<ClaimDetail, 'facility_id' | 'facility_name'>;
  findFacilities: (q: string, signal: AbortSignal) => Promise<FacilityOption[]>;
  locked: string | undefined;
  onSave: (facilityId: string | null) => Promise<void>;
}) => {
  const [query, setQuery] = useState('');
  const facilities = useResource(`facility-options:${query.trim()}`, (signal) =>
    findFacilities(query, signal)
  );
  const [chosen, setChosen] = useState(claim.facility_id ?? NO_FACILITY);
  const [busy, setBusy] = useState(false);
  const saved = claim.facility_id ?? NO_FACILITY;
  const current =
    claim.facility_id && claim.facility_name
      ? { id: claim.facility_id, name: claim.facility_name }
      : null;
  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onSave(chosen === NO_FACILITY ? null : chosen);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={save} aria-label="Save responsible facility">
      <SectionPanel
        title="Responsible Facility"
        description="A hospital or nursing facility that pays for this trip instead of the payers, on its monthly invoice."
      >
        {facilities.error ? <Alert>{facilities.error.message}</Alert> : null}
        <fieldset disabled={busy || locked !== undefined}>
          <FieldGrid>
            <Input
              id="claim-facility-search"
              label="Find Facility"
              type="search"
              hint="Type part of a name to list matching facilities."
              maxLength={80}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Select
              id="claim-facility"
              label="Facility"
              hint={locked ?? 'Facilities are listed under Admin, Facilities.'}
              options={facilityOptions(facilities.data ?? [], current)}
              value={chosen}
              onChange={setChosen}
            />
          </FieldGrid>
        </fieldset>
        <FormActions>
          <Button
            type="submit"
            variant="outline"
            isPending={busy}
            disabledReason={
              locked ?? (chosen === saved ? 'Choose another facility first.' : undefined)
            }
          >
            <SaveIcon aria-hidden="true" className="size-4" />
            Save Facility
          </Button>
        </FormActions>
      </SectionPanel>
    </form>
  );
};

export const RecordsRequestPanel = ({
  locked,
  onRequest
}: {
  locked: string | undefined;
  onRequest: (request: RecordsRequestInput) => Promise<boolean>;
}) => {
  const [dueOn, setDueOn] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    const done = await onRequest({ dueOn: dueOn || null, note: note.trim() });
    setBusy(false);
    if (done) {
      setDueOn('');
      setNote('');
    }
  };
  return (
    <form onSubmit={submit} aria-label="Log records request">
      <SectionPanel
        title="Records Request"
        description="Log a payer request for records (an ADR); a task with its due date asks a biller to gather and send them."
      >
        <fieldset disabled={busy || locked !== undefined}>
          <FieldGrid>
            <Input
              id="records-due"
              label="Due Date"
              type="date"
              hint="Leave empty for the days the payer allows."
              value={dueOn}
              onChange={(e) => setDueOn(e.target.value)}
            />
            <Input
              id="records-note"
              label="Requested Records"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </FieldGrid>
        </fieldset>
        <FormActions>
          <Button type="submit" variant="outline" isPending={busy} disabledReason={locked}>
            <FileClockIcon aria-hidden="true" className="size-4" />
            Log Records Request
          </Button>
        </FormActions>
      </SectionPanel>
    </form>
  );
};

export const ClaimRecovery = ({
  client,
  claim,
  locked,
  onChanged
}: {
  client: ClaimsClient;
  claim: ClaimDetail;
  locked: string | undefined;
  onChanged: () => void;
}) => {
  const [error, setError] = useState('');
  const notify = useToast();
  const setFacility = async (facilityId: string | null) => {
    setError('');
    try {
      await client.setFacility(claim.id, facilityId);
      notify({
        title: facilityId ? 'Facility responsible for this trip' : 'No facility responsible'
      });
      onChanged();
    } catch (err) {
      setError(messageOf(err));
    }
  };
  const requestRecords = async (request: RecordsRequestInput) => {
    setError('');
    try {
      await client.requestRecords(claim.id, request);
      notify({ title: 'Records request logged', description: 'A task asks to send the records.' });
      onChanged();
      return true;
    } catch (err) {
      setError(messageOf(err));
      return false;
    }
  };
  return (
    <>
      {error ? <Alert>{error}</Alert> : null}
      <FacilityPanel
        key={claim.facility_id ?? 'none'}
        claim={claim}
        findFacilities={client.facilities}
        locked={locked}
        onSave={setFacility}
      />
      <RecordsRequestPanel locked={locked} onRequest={requestRecords} />
    </>
  );
};
