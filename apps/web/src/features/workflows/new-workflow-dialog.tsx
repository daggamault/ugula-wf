import { PlusIcon, XIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { navigate } from '../../shared/router.tsx';
import { Alert } from '../../shared/ui/alert.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { Dialog, DialogActions } from '../../shared/ui/dialog.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { Select } from '../../shared/ui/select.tsx';
import type { GraphKind, WorkflowsClient } from './client.ts';

export type NewWorkflowDialogProps = {
  client: WorkflowsClient;
  kind: GraphKind;
  open: boolean;
  onClose: () => void;
};

const KINDS = [
  { value: 'workflow', label: 'Workflow' },
  { value: 'node', label: 'Building block' }
] as const;

export const NewWorkflowDialog = ({ client, kind, open, onClose }: NewWorkflowDialogProps) => {
  const [form, setForm] = useState({
    key: '',
    name: '',
    kind,
    description: ''
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { id } = await client.create(form);
      navigate(`/workflows/${id}`);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="New Workflow"
      description="Start a workflow, or a building block other workflows can use."
      onClose={onClose}
    >
      <form onSubmit={submit} className="flex flex-col gap-6">
        <fieldset disabled={busy} className="flex flex-col gap-5">
          <Input
            id="graph-name"
            label="Name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Input
            id="graph-key"
            label="Key"
            required
            isMonospace
            placeholder="billing.match-patient"
            hint="Dotted lowercase; used to reference this building block from other workflows."
            value={form.key}
            onChange={(e) => setForm({ ...form, key: e.target.value })}
          />
          <Select
            id="graph-kind"
            label="Kind"
            options={KINDS}
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value as GraphKind })}
          />
          <Input
            id="graph-description"
            label="Description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </fieldset>
        {error ? <Alert>{error}</Alert> : null}
        <DialogActions>
          <Button variant="outline" onClick={onClose}>
            <XIcon aria-hidden="true" className="size-4" />
            Cancel
          </Button>
          <Button type="submit" isPending={busy}>
            <PlusIcon aria-hidden="true" className="size-4" />
            Create
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};
