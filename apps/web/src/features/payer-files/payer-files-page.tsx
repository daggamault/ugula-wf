import { useState } from 'react';
import { formatDateTime } from '../../shared/format.ts';
import { LIST_RELOAD_MS, type Live, useLive } from '../../shared/live.ts';
import { Badge } from '../../shared/ui/badge.tsx';
import { emptyValue } from '../../shared/ui/empty-state.tsx';
import { FileButton } from '../../shared/ui/file-button.tsx';
import { OpenLink } from '../../shared/ui/icon-button.tsx';
import { Page } from '../../shared/ui/page.tsx';
import { Search } from '../../shared/ui/search.tsx';
import { Table, TableCell, TableRow } from '../../shared/ui/table.tsx';
import { type SearchView, useSearchState, withBack } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import type { PayerFileSummary, PayerFilesClient } from './client.ts';
import { fileStatus, kindOf, useUploadPayerFiles } from './payer-files.ts';

const PATH = '/payer-files';

const PAYER_FILE_TABLE = {
  sorts: { received: 'desc', name: 'asc', kind: 'asc', problems: 'desc' },
  sort: 'received'
} as const;

export const PayerFilesTable = ({
  files,
  search
}: {
  files: readonly PayerFileSummary[];
  search?: SearchView;
}) => (
  <Table
    label="Payer files"
    {...(search ? { sorting: search } : {})}
    head={[
      { label: 'File', sort: 'name' },
      { label: 'Kind', sort: 'kind' },
      { label: 'Received', isSecondary: true, sort: 'received' },
      { label: 'Lines' },
      { label: 'Outcome', sort: 'problems' },
      { label: 'Actions', isLabelHidden: true, isCompact: true }
    ]}
  >
    {files.map((f) => {
      const status = fileStatus(f);
      return (
        <TableRow key={f.id}>
          <TableCell>
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">{f.file_name}</span>
              <span className="text-surface-fg-muted text-xs">{f.uploaded_by ?? emptyValue}</span>
            </span>
          </TableCell>
          <TableCell>{kindOf(f)}</TableCell>
          <TableCell kind="date" isMuted isSecondary>
            {formatDateTime(f.created_at)}
          </TableCell>
          <TableCell kind="numeric">{f.item_count}</TableCell>
          <TableCell>
            <Badge intent={status.intent}>{status.label}</Badge>
          </TableCell>
          <TableCell kind="actions">
            <OpenLink
              to={withBack(`${PATH}/${f.id}`, search?.href ?? '')}
              name={`payer file ${f.file_name}`}
            />
          </TableCell>
        </TableRow>
      );
    })}
  </Table>
);

export const PayerFilesPage = ({ client, live }: { client: PayerFilesClient; live: Live }) => {
  const search = useSearchState(PATH, PAYER_FILE_TABLE);
  const files = useResource(`payer-files:${search.apiQuery}`, (signal) =>
    client.list(search.apiQuery, signal)
  );
  useLive(live, (e) => e.kind === 'claim', files.reload, LIST_RELOAD_MS);
  const upload = useUploadPayerFiles(client);
  const [busy, setBusy] = useState(false);

  const choose = async (picked: File[]) => {
    if (!picked.length) return;
    setBusy(true);
    try {
      if (await upload(picked)) files.reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page
      title="Payer Files"
      description="Remittances (835), acknowledgments (TA1, 999 and 277CA), claim status (277) and eligibility responses (271) from your clearinghouse, applied to their claims."
      actions={
        <FileButton
          label="Upload Payer Files"
          busy={busy}
          onFiles={(picked) => void choose(picked)}
        />
      }
    >
      <Search
        label="Payer Files"
        path={PATH}
        search={search}
        results={files}
        empty={{
          title: 'No Payer Files Yet',
          children:
            'Upload the files your clearinghouse returns: payments post, rejections reopen claims and eligibility lands on each payer.'
        }}
      >
        {(items) => <PayerFilesTable files={items} search={search} />}
      </Search>
    </Page>
  );
};
