import { useState } from 'react';
import { isOnPage, LIST_RELOAD_MS, type Live, useLive } from '../../shared/live.ts';
import { FileButton } from '../../shared/ui/file-button.tsx';
import { Page } from '../../shared/ui/page.tsx';
import { Search } from '../../shared/ui/search.tsx';
import { useSearchState } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import type { ImportsClient } from './client.ts';
import { useImportFiles } from './import-files.ts';
import { IMPORT_TABLE, ImportHistory } from './import-history.tsx';

type ImportsPageProps = {
  client: ImportsClient;
  live: Live;
};

const PATH = '/imports';

export const ImportsPage = ({ client, live }: ImportsPageProps) => {
  const search = useSearchState(PATH, IMPORT_TABLE);
  const history = useResource(
    `imports:${search.apiQuery}`,
    (signal) => client.list(search.apiQuery, signal),
    30_000
  );
  const items = history.data?.items ?? [];
  const runs = new Set(items.map((i) => i.run_id));
  useLive(
    live,
    (e) =>
      (e.kind === 'import' &&
        isOnPage(
          e.id,
          search.page,
          items.map((i) => i.id)
        )) ||
      (e.kind === 'run' && (runs.has(e.id) || (e.parentId !== null && runs.has(e.parentId)))),
    history.reload,
    LIST_RELOAD_MS
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
      description="Drop NEMSIS XML anywhere in the app, or send it to your SFTP folder."
      actions={
        <FileButton
          label="Import Files"
          accept=".xml,application/xml,text/xml"
          busy={busy}
          onFiles={(files) => void choose(files)}
        />
      }
    >
      <Search
        label="Imports"
        path={PATH}
        search={search}
        results={history}
        empty={{
          title: 'No Imports Yet',
          children: 'Drag NEMSIS XML files onto any page, or use Import Files.'
        }}
      >
        {(imports) => <ImportHistory imports={imports} search={search} />}
      </Search>
    </Page>
  );
};
