import { formatCents, formatDateTime } from '../../shared/format.ts';
import { type Live, useLive } from '../../shared/live.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { Badge } from '../../shared/ui/badge.tsx';
import { ButtonLink } from '../../shared/ui/button.tsx';
import { EmptyState, emptyValue } from '../../shared/ui/empty-state.tsx';
import { Page, PageLoading } from '../../shared/ui/page.tsx';
import { Pagination } from '../../shared/ui/pagination.tsx';
import { Table, TableCell, TableRow, type TableSorting } from '../../shared/ui/table.tsx';
import { useTableState } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import { BatchDownload } from './claims-page.tsx';
import type { Batch, ClaimsClient } from './client.ts';

export const FILE_TABLE = {
  sorts: { created: 'desc', control: 'desc', claims: 'desc', total: 'desc' },
  sort: 'created'
} as const;

export const FilesTable = ({
  batches,
  sorting,
  fileUrl
}: {
  batches: readonly Batch[];
  sorting?: TableSorting;
  fileUrl: (id: string) => string;
}) => (
  <Table
    label="837P files"
    {...(sorting ? { sorting } : {})}
    head={[
      { label: 'File', sort: 'control' },
      { label: 'Created', sort: 'created' },
      { label: 'Claims', isNumeric: true, sort: 'claims' },
      { label: 'Total', isNumeric: true, sort: 'total' },
      'Usage',
      { label: 'Created By', isSecondary: true },
      { label: 'Actions', isLabelHidden: true, isCompact: true }
    ]}
  >
    {batches.map((b) => (
      <TableRow key={b.id}>
        <TableCell>
          <span className="font-mono font-semibold">#{b.control_number}</span>
        </TableCell>
        <TableCell kind="date" isMuted>
          {formatDateTime(b.created_at)}
        </TableCell>
        <TableCell kind="numeric">{b.claim_count}</TableCell>
        <TableCell kind="numeric">{formatCents(b.total_cents)}</TableCell>
        <TableCell>
          {b.production ? (
            <Badge intent="success">Production</Badge>
          ) : (
            <Badge intent="warning">Test</Badge>
          )}
        </TableCell>
        <TableCell isMuted isSecondary>
          {b.created_by_email ?? emptyValue}
        </TableCell>
        <TableCell kind="actions">
          <BatchDownload batch={b} href={fileUrl(b.id)} />
        </TableCell>
      </TableRow>
    ))}
  </Table>
);

export const FilesPage = ({ client, live }: { client: ClaimsClient; live: Live }) => {
  const table = useTableState('/claims/files', FILE_TABLE);
  const files = useResource(`claims:files:${table.apiQuery}`, () => client.batches(table.apiQuery));
  useLive(live, (e) => e.kind === 'claim' && e.id === null, files.reload);
  return (
    <Page
      title="837P Files"
      description="Every 837P file created for your clearinghouse, newest first. Download one again if an upload failed."
      backTo="/claims"
      backLabel="Back to Claims"
    >
      {files.error ? <Alert>{files.error.message}</Alert> : null}
      {files.data?.items.length ? (
        <>
          <FilesTable batches={files.data.items} sorting={table} fileUrl={client.fileUrl} />
          <Pagination label="837P files" total={files.data.total} state={table} />
        </>
      ) : files.loading ? (
        <PageLoading />
      ) : (
        <EmptyState
          title="No Files Yet"
          action={
            <ButtonLink to="/claims?view=ready" variant="outline">
              See ready claims
            </ButtonLink>
          }
        >
          Create an 837P file from the claims that are ready to submit.
        </EmptyState>
      )}
    </Page>
  );
};
