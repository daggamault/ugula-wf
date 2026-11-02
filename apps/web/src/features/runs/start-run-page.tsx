import type { Json } from '@ugula/graph';
import { PlayIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { navigate } from '../../shared/router.tsx';
import { Alert } from '../../shared/ui/alert.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { EmptyText } from '../../shared/ui/empty-state.tsx';
import { Page, PageLoading } from '../../shared/ui/page.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { ValueField } from '../../shared/ui/value-field.tsx';
import { useResource } from '../../shared/use-resource.ts';
import type { RunsClient, Startable } from './client.ts';

export type StartRunPageProps = {
  client: RunsClient;
  graphId: string;
};

export const StartRunForm = ({ client, target }: { client: RunsClient; target: Startable }) => {
  const [inputs, setInputs] = useState<Record<string, Json>>(() =>
    Object.fromEntries(target.signature.inputs.map((p) => [p.name, p.default ?? null]))
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const notify = useToast();

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { id, version } = await client.start(target.graphId, inputs);
      notify({ title: `${target.name} v${version} started` });
      navigate(`/runs/${id}`);
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex max-w-2xl flex-col gap-6">
      <SectionPanel
        title="Inputs"
        description="Values this run starts with. Leave optional inputs empty to use their defaults."
      >
        <fieldset disabled={busy} className="flex flex-col gap-5">
          {target.signature.inputs.length ? (
            target.signature.inputs.map((pin) => (
              <ValueField
                key={pin.name}
                id={`input-${pin.name}`}
                label={pin.label ?? pin.name}
                type={pin.type}
                value={inputs[pin.name] ?? null}
                onChange={(value) => setInputs({ ...inputs, [pin.name]: value })}
                upload={client.uploadFile}
              />
            ))
          ) : (
            <EmptyText>This workflow takes no inputs.</EmptyText>
          )}
        </fieldset>
        {error ? <Alert>{error}</Alert> : null}
        <div>
          <Button type="submit" isPending={busy}>
            <PlayIcon aria-hidden="true" className="size-4" />
            Start run
          </Button>
        </div>
      </SectionPanel>
    </form>
  );
};

export const StartRunPage = ({ client, graphId }: StartRunPageProps) => {
  const target = useResource(`startable:${graphId}`, () => client.startable(graphId));
  return (
    <Page
      title={target.data ? `Run ${target.data.name}` : 'Start a Run'}
      description={target.data ? `Runs published version ${target.data.version}.` : undefined}
      backTo={graphId ? `/workflows/${graphId}` : '/workflows'}
      backLabel="Back to Workflow"
    >
      {target.error ? <Alert>{target.error.message}</Alert> : null}
      {target.data ? (
        <StartRunForm client={client} target={target.data} />
      ) : target.loading ? (
        <PageLoading />
      ) : null}
    </Page>
  );
};
