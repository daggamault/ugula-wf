import { FileUpIcon } from 'lucide-react';
import { useState } from 'react';
import { type Live, useLive } from '../../shared/live.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { EmptyText } from '../../shared/ui/empty-state.tsx';
import { Page, PageLoading } from '../../shared/ui/page.tsx';
import { Section } from '../../shared/ui/section-panel.tsx';
import { Spinner } from '../../shared/ui/spinner.tsx';
import { useResource } from '../../shared/use-resource.ts';
import type { ImportsClient } from './client.ts';
import { useImportFiles } from './import-files.ts';
import { ImportHistory } from './import-history.tsx';

export type ImportsPageProps = {
  client: ImportsClient;
  live: Live;
};

export const FilePicker = ({
  busy,
  onFiles
}: {
  busy: boolean;
  onFiles: (files: File[]) => void;
}) => (
  <label
    htmlFor="import-files"
    aria-busy={busy || undefined}
    className="border-border bg-surface hover:border-primary/50 hover:bg-primary/5 has-focus-visible:border-primary flex cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-14 text-center transition duration-150 ease-out aria-busy:cursor-wait"
  >
    <span
      aria-hidden="true"
      className="bg-primary/10 text-primary grid size-14 place-items-center rounded-full"
    >
      {busy ? <Spinner /> : <FileUpIcon className="size-7" />}
    </span>
    <span className="text-base font-bold">
      {busy ? 'Importing…' : 'Drop NEMSIS files anywhere, or choose them here'}
    </span>
    <span className="text-surface-fg-muted max-w-md text-sm">
      NEMSIS 3.5 XML exports. Each patient care report becomes its own claim: patients and payers
      are matched, the narrative is read, and anything uncertain goes to a queue for review.
    </span>
    <input
      id="import-files"
      type="file"
      multiple
      disabled={busy}
      accept=".xml,application/xml,text/xml"
      onChange={(e) => {
        onFiles([...(e.target.files ?? [])]);
        e.target.value = '';
      }}
      className="sr-only"
    />
  </label>
);

export const ImportsPage = ({ client, live }: ImportsPageProps) => {
  const history = useResource('imports', client.list, 30_000);
  const runs = new Set(history.data?.map((i) => i.run_id));
  useLive(
    live,
    (e) =>
      e.kind === 'import' ||
      (e.kind === 'run' && (runs.has(e.id) || (e.parentId !== null && runs.has(e.parentId)))),
    history.reload
  );
  const importFiles = useImportFiles(client);
  const [busy, setBusy] = useState(false);

  const choose = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    try {
      if (await importFiles(files)) history.reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page
      title="Imports"
      description="Bring in patient care reports from your ePCR system. Files sent to your SFTP folder are imported the same way."
    >
      <FilePicker busy={busy} onFiles={(files) => void choose(files)} />
      <Section
        title="Recent Imports"
        description="Every file received by upload or SFTP, and where its reports are now."
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
