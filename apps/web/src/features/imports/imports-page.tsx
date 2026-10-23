import { FileUpIcon, UploadIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { type Live, useLive } from '../../shared/live.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { Button, ButtonLink } from '../../shared/ui/button.tsx';
import { EmptyText } from '../../shared/ui/empty-state.tsx';
import { Page, PageLoading } from '../../shared/ui/page.tsx';
import { Section, SectionPanel } from '../../shared/ui/section-panel.tsx';
import { useResource } from '../../shared/use-resource.ts';
import type { ImportResult, ImportsClient } from './client.ts';
import { ImportHistory } from './import-history.tsx';

export type ImportsPageProps = {
  client: ImportsClient;
  live: Live;
};

export const ImportsPage = ({ client, live }: ImportsPageProps) => {
  const history = useResource('imports', client.list, 30_000);
  useLive(live, history.reload);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [received, setReceived] = useState<{ name: string; result: ImportResult } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!file) return;
    const form = e.currentTarget;
    setBusy(true);
    setError('');
    setReceived(null);
    try {
      setReceived({ name: file.name, result: await client.upload(file) });
      setFile(null);
      form.reset();
      history.reload();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page
      title="Imports"
      description="Upload a NEMSIS 3.5 export. Each patient care report becomes its own claim run."
    >
      {received ? (
        <Alert
          intent="success"
          action={
            <ButtonLink to={`/runs/${received.result.runId}`} variant="outline" size="sm">
              View run
            </ButtonLink>
          }
        >
          {received.name} was received. Its reports are being matched to patients and queued for
          review.
        </Alert>
      ) : null}
      <form onSubmit={submit} className="flex max-w-2xl flex-col gap-6">
        <SectionPanel
          title="NEMSIS File"
          description="Patient care reports are matched to patients and priced as claims."
        >
          <fieldset disabled={busy}>
            <label
              htmlFor="import-file"
              className="border-border bg-canvas hover:border-primary/50 has-focus-visible:border-primary flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed px-4 py-10 text-center transition duration-150 ease-out"
            >
              <span
                aria-hidden="true"
                className="bg-primary/10 text-primary grid size-12 place-items-center rounded-full"
              >
                <FileUpIcon className="size-6" />
              </span>
              <span className="text-sm font-semibold">
                {file ? file.name : 'Choose a NEMSIS XML file'}
              </span>
              <span className="text-surface-fg-muted text-xs">
                {file ? `${(file.size / 1024).toFixed(0)} KB` : 'XML exports only'}
              </span>
              <input
                id="import-file"
                type="file"
                accept=".xml,application/xml,text/xml"
                required
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="sr-only"
              />
            </label>
          </fieldset>
          {error ? <Alert>{error}</Alert> : null}
          <div>
            <Button
              type="submit"
              isPending={busy}
              disabledReason={file ? undefined : 'Choose a file first.'}
            >
              <UploadIcon aria-hidden="true" className="size-4" />
              Import
            </Button>
          </div>
        </SectionPanel>
      </form>
      <Section
        title="Recent Imports"
        description="Every file received by upload or SFTP, and what became of its reports."
      >
        {history.error ? <Alert>{history.error.message}</Alert> : null}
        {history.data?.length ? (
          <ImportHistory imports={history.data} />
        ) : history.loading ? (
          <PageLoading />
        ) : (
          <EmptyText>No files have been imported yet.</EmptyText>
        )}
      </Section>
    </Page>
  );
};
