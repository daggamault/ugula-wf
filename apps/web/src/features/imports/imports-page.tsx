import { FileUpIcon } from 'lucide-react';
import { useState } from 'react';
import { classNamesOf } from '../../shared/class-names.ts';
import { type Live, useLive } from '../../shared/live.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { buttonClasses } from '../../shared/ui/button.tsx';
import { EmptyState } from '../../shared/ui/empty-state.tsx';
import { Page, PageLoading } from '../../shared/ui/page.tsx';
import { Pagination } from '../../shared/ui/pagination.tsx';
import { Spinner } from '../../shared/ui/spinner.tsx';
import { useTableState } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import type { ImportsClient } from './client.ts';
import { useImportFiles } from './import-files.ts';
import { IMPORT_TABLE, ImportHistory } from './import-history.tsx';

export type ImportsPageProps = {
  client: ImportsClient;
  live: Live;
};

export const ImportButton = ({
  busy,
  onFiles
}: {
  busy: boolean;
  onFiles: (files: File[]) => void;
}) => (
  <label
    htmlFor="import-files"
    aria-busy={busy || undefined}
    className={classNamesOf(
      buttonClasses(),
      'cursor-pointer has-focus-visible:outline-2 aria-busy:cursor-wait'
    )}
  >
    {busy ? <Spinner /> : <FileUpIcon aria-hidden="true" className="size-4" />}
    {busy ? 'Importing…' : 'Import files'}
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
  const table = useTableState('/imports', IMPORT_TABLE);
  const history = useResource(
    `imports:${table.apiQuery}`,
    () => client.list(table.apiQuery),
    30_000
  );
  const runs = new Set(history.data?.items.map((i) => i.run_id));
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
      description="NEMSIS XML from your ePCR system. Drop files anywhere in the app or send them to your SFTP folder."
      actions={<ImportButton busy={busy} onFiles={(files) => void choose(files)} />}
    >
      {history.error ? (
        <Alert>{history.error.message}</Alert>
      ) : history.data?.items.length ? (
        <>
          <ImportHistory imports={history.data.items} sorting={table} />
          <Pagination label="Imports" total={history.data.total} state={table} />
        </>
      ) : history.loading ? (
        <PageLoading />
      ) : (
        <EmptyState title="No Imports Yet">
          Drag NEMSIS XML files onto any page, or use Import files.
        </EmptyState>
      )}
    </Page>
  );
};
