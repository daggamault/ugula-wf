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

export const facilityOptions = (facilities: readonly FacilityOption[]) => [
  { value: NO_FACILITY, label: 'None: bill the payers and the patient' },
  ...facilities.map((f) => ({ value: f.id, label: f.name }))
];

export const FacilityPanel = ({
  claim,
  facilities,
  locked,
  onSave
}: {
  claim: Pick<ClaimDetail, 'facility_id' | 'facility_name'>;
  facilities: readonly FacilityOption[];
  locked: string | undefined;
  onSave: (facilityId: string | null) => Promise<void>;
}) => {
  const [chosen, setChosen] = useState(claim.facility_id ?? NO_FACILITY);
  const [busy, setBusy] = useState(false);
  const saved = claim.facility_id ?? NO_FACILITY;
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
        <fieldset disabled={busy || locked !== undefined}>
          <Select
            id="claim-facility"
            label="Facility"
            hint={locked ?? 'Facilities are listed under Admin, Facilities.'}
            options={facilityOptions(facilities)}
            value={chosen}
            onChange={(e) => setChosen(e.target.value)}
          />
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
  const facilities = useResource('facility-options', client.facilities);
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
        facilities={facilities.data ?? []}
        locked={locked}
        onSave={setFacility}
      />
      <RecordsRequestPanel locked={locked} onRequest={requestRecords} />
    </>
  );
};
