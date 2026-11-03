import type { Json, ValueType } from '@ugula/graph';
import { PlayIcon, XIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { classNamesOf } from '../../shared/class-names.ts';
import { type Live, useReconnect } from '../../shared/live.ts';
import { navigate } from '../../shared/router.tsx';
import { Alert } from '../../shared/ui/alert.tsx';
import { Button, ButtonLink } from '../../shared/ui/button.tsx';
import { EmptyText } from '../../shared/ui/empty-state.tsx';
import { FieldGrid, FormActions } from '../../shared/ui/field.tsx';
import { Page, PageLoading } from '../../shared/ui/page.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { isFileType, ValueField } from '../../shared/ui/value-field.tsx';
import { useResource } from '../../shared/use-resource.ts';
import type { RunsClient, Startable } from './client.ts';

const backOf = (graphId: string) => (graphId ? `/workflows/${graphId}` : '/workflows');

type StartRunPageProps = {
  client: RunsClient;
  live: Live;
  graphId: string;
};

export const inputSpanClasses = (type: ValueType) =>
  typeof type === 'string' && type !== 'any'
    ? ''
    : isFileType(type)
      ? '@lg:col-span-2'
      : '@lg:col-span-2 @3xl:col-span-4';

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
    <form onSubmit={submit} className="flex flex-col gap-6">
      <SectionPanel
        title="Inputs"
        description="Values this run starts with. Leave optional inputs empty to use their defaults."
      >
        <fieldset disabled={busy}>
          {target.signature.inputs.length ? (
            <FieldGrid>
              {target.signature.inputs.map((pin) => (
                <div key={pin.name} className={classNamesOf('min-w-0', inputSpanClasses(pin.type))}>
                  <ValueField
                    id={`input-${pin.name}`}
                    label={pin.label ?? pin.name}
                    type={pin.type}
                    value={inputs[pin.name] ?? null}
                    onChange={(value) => setInputs((prev) => ({ ...prev, [pin.name]: value }))}
                    upload={client.uploadFile}
                  />
                </div>
              ))}
            </FieldGrid>
          ) : (
            <EmptyText>This workflow takes no inputs.</EmptyText>
          )}
        </fieldset>
        {error ? <Alert>{error}</Alert> : null}
        <FormActions>
          <ButtonLink to={backOf(target.graphId)} variant="outline">
            <XIcon aria-hidden="true" className="size-4" />
            Cancel
          </ButtonLink>
          <Button type="submit" isPending={busy}>
            <PlayIcon aria-hidden="true" className="size-4" />
            Start Run
          </Button>
        </FormActions>
      </SectionPanel>
    </form>
  );
};

export const StartRunPage = ({ client, live, graphId }: StartRunPageProps) => {
  const target = useResource(`startable:${graphId}`, () => client.startable(graphId));
  useReconnect(live, target.reload);
  return (
    <Page
      title={target.data ? `Run ${target.data.name}` : 'Start a Run'}
      description={target.data ? `Runs published version ${target.data.version}.` : undefined}
      backTo={backOf(graphId)}
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
