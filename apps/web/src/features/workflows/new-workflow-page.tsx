import { PlusIcon, XIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { navigate, useLocation } from '../../shared/router.tsx';
import { Alert } from '../../shared/ui/alert.tsx';
import { Button, ButtonLink } from '../../shared/ui/button.tsx';
import { FieldGrid, FormActions } from '../../shared/ui/field.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { Page } from '../../shared/ui/page.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { Select } from '../../shared/ui/select.tsx';
import { hrefWith } from '../../shared/url-state.ts';
import type { GraphKind, NewGraph, WorkflowsClient } from './client.ts';
import { kindLabel, WORKFLOWS_PATH } from './workflows-page.tsx';

type NewWorkflowPageProps = {
  client: WorkflowsClient;
  kind: GraphKind;
  back: string;
};

const GRAPH_KINDS = [
  { value: 'workflow', label: 'Workflow' },
  { value: 'node', label: 'Building Block' }
] as const;

export const graphKindOf = (query: URLSearchParams): GraphKind =>
  query.get('kind') === 'node' ? 'node' : 'workflow';

export const NewWorkflowForm = ({
  kind,
  back,
  onKindChange,
  onCreate
}: {
  kind: GraphKind;
  back: string;
  onKindChange: (kind: GraphKind) => void;
  onCreate: (graph: NewGraph) => Promise<string | null>;
}) => {
  const [fields, setForm] = useState<Omit<NewGraph, 'kind'>>({
    key: '',
    name: '',
    description: ''
  });
  const form: NewGraph = { ...fields, kind };
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const failure = await onCreate(form);
    setBusy(false);
    if (failure) setError(failure);
  };
  return (
    <form onSubmit={submit} aria-label={`Create ${kindLabel(form.kind)}`}>
      <SectionPanel
        title={kindLabel(form.kind)}
        description="Start a workflow, or a building block other workflows can use."
      >
        <fieldset disabled={busy}>
          <FieldGrid>
            <Input
              id="graph-name"
              label="Name"
              span={2}
              required
              value={form.name}
              onChange={(e) => setForm({ ...fields, name: e.target.value })}
            />
            <Input
              id="graph-key"
              label="Key"
              span={2}
              required
              isMonospace
              placeholder="billing.match-patient"
              hint="Dotted lowercase; used to reference this building block from other workflows."
              value={form.key}
              onChange={(e) => setForm({ ...fields, key: e.target.value })}
            />
            <Select
              id="graph-kind"
              label="Kind"
              span={2}
              options={GRAPH_KINDS}
              value={form.kind}
              onChange={(e) => onKindChange(e.target.value === 'node' ? 'node' : 'workflow')}
            />
            <Input
              id="graph-description"
              label="Description"
              span={2}
              value={form.description}
              onChange={(e) => setForm({ ...fields, description: e.target.value })}
            />
          </FieldGrid>
        </fieldset>
        {error ? <Alert>{error}</Alert> : null}
        <FormActions>
          <ButtonLink to={back} variant="outline">
            <XIcon aria-hidden="true" className="size-4" />
            Cancel
          </ButtonLink>
          <Button type="submit" isPending={busy}>
            <PlusIcon aria-hidden="true" className="size-4" />
            Create {kindLabel(form.kind)}
          </Button>
        </FormActions>
      </SectionPanel>
    </form>
  );
};

export const NewWorkflowPage = ({ client, kind, back }: NewWorkflowPageProps) => {
  const { query } = useLocation();
  return (
    <Page
      title={kind === 'node' ? 'New Building Block' : 'New Workflow'}
      description="Give it a name and key, then build it in the editor."
      backTo={back}
      backLabel="Back to Workflows"
    >
      <NewWorkflowForm
        kind={kind}
        back={back}
        onKindChange={(next) =>
          navigate(
            hrefWith(`${WORKFLOWS_PATH}/new`, query, { kind: next === 'node' ? 'node' : null }),
            {
              replace: true
            }
          )
        }
        onCreate={async (graph) => {
          try {
            const { id } = await client.create(graph);
            navigate(`/workflows/${id}`);
            return null;
          } catch (err) {
            return messageOf(err);
          }
        }}
      />
    </Page>
  );
};
