import { CheckIcon, PlusIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { Dialog } from '../../shared/ui/dialog.tsx';
import { FormActions } from '../../shared/ui/field.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { Select } from '../../shared/ui/select.tsx';
import type { GraphDetails, GraphKind } from './client.ts';

export const kindLabel = (kind: GraphKind) => (kind === 'workflow' ? 'Workflow' : 'Subworkflow');

const GRAPH_KINDS = [
  { value: 'workflow', label: 'Workflow' },
  { value: 'node', label: 'Subworkflow' }
] as const;

type DetailsDialogProps = {
  kind: GraphKind;
  initial?: GraphDetails;
  onClose: () => void;
} & (
  | { mode: 'create'; onSubmit: (details: GraphDetails & { kind: GraphKind }) => Promise<void> }
  | { mode: 'edit'; onSubmit: (details: GraphDetails) => Promise<void> }
);

const BLANK: GraphDetails = { name: '', description: '' };

export const WorkflowDetailsDialog = (props: DetailsDialogProps) => {
  const { initial = BLANK, onClose } = props;
  const [details, setDetails] = useState(initial);
  const [kind, setKind] = useState(props.kind);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isCreate = props.mode === 'create';
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (props.mode === 'create') await props.onSubmit({ ...details, kind });
      else await props.onSubmit(details);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      title={isCreate ? `New ${kindLabel(kind)}` : `${kindLabel(kind)} Details`}
      description={
        isCreate
          ? 'Name it; you add its nodes next. Other workflows find it by this name.'
          : 'Renaming changes only what people see; everything that uses it keeps working.'
      }
      onClose={onClose}
    >
      <form
        className="flex flex-col gap-4"
        aria-label={isCreate ? `Create ${kindLabel(kind)}` : `${kindLabel(kind)} details`}
        onSubmit={submit}
      >
        <fieldset disabled={busy} className="flex flex-col gap-4">
          <Input
            id="graph-name"
            label="Name"
            required
            maxLength={120}
            value={details.name}
            onChange={(e) => setDetails({ ...details, name: e.target.value })}
          />
          {isCreate ? (
            <Select
              id="graph-kind"
              label="Kind"
              options={GRAPH_KINDS}
              value={kind}
              onChange={(v) => setKind(v === 'node' ? 'node' : 'workflow')}
            />
          ) : null}
          <Input
            id="graph-description"
            label="Description"
            maxLength={2000}
            value={details.description}
            onChange={(e) => setDetails({ ...details, description: e.target.value })}
          />
        </fieldset>
        {error ? <Alert>{error}</Alert> : null}
        <FormActions>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isPending={busy}>
            {isCreate ? (
              <PlusIcon aria-hidden="true" className="size-4" />
            ) : (
              <CheckIcon aria-hidden="true" className="size-4" />
            )}
            {isCreate ? `Create ${kindLabel(kind)}` : 'Save Details'}
          </Button>
        </FormActions>
      </form>
    </Dialog>
  );
};
