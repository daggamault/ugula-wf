import { CheckIcon, DownloadIcon, FileCogIcon, SendIcon } from 'lucide-react';
import { useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { formatCents, formatDateTime } from '../../shared/format.ts';
import { type Live, useLive } from '../../shared/live.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { Badge } from '../../shared/ui/badge.tsx';
import { Button, ButtonLink, buttonClasses } from '../../shared/ui/button.tsx';
import { ConfirmDialog } from '../../shared/ui/dialog.tsx';
import { EmptyText, emptyValue } from '../../shared/ui/empty-state.tsx';
import { Page, PageLoading } from '../../shared/ui/page.tsx';
import { Pagination } from '../../shared/ui/pagination.tsx';
import { Section } from '../../shared/ui/section-panel.tsx';
import { Table, TableCell, TableRow, type TableSorting } from '../../shared/ui/table.tsx';
import { TextLink } from '../../shared/ui/text-link.tsx';
import { pageOf, useTableState } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import type { Batch, PendingClaim, SubmissionsClient } from './client.ts';

export type SubmissionsPageProps = {
  client: SubmissionsClient;
  live: Live;
};

export const selectedIds = (claims: readonly PendingClaim[], excluded: ReadonlySet<string>) =>
  claims.filter((c) => !c.issues.length && !excluded.has(c.id)).map((c) => c.id);

const PATH = '/submissions';

export const PENDING_TABLE = {
  prefix: 'pending',
  sorts: { readiness: 'asc', patient: 'asc', service: 'desc', payer: 'asc', total: 'desc' },
  sort: 'readiness'
} as const;

export const BATCH_TABLE = {
  prefix: 'batches',
  sorts: { created: 'desc', control: 'desc', claims: 'desc', total: 'desc' },
  sort: 'created'
} as const;

export const PENDING_VALUES = {
  readiness: (c: PendingClaim) => c.issues.length,
  patient: (c: PendingClaim) => c.patient,
  service: (c: PendingClaim) => c.serviceDate,
  payer: (c: PendingClaim) => c.payer,
  total: (c: PendingClaim) => c.totalCents
};

export const PendingTable = ({
  claims,
  excluded,
  sorting,
  onToggle,
  onMarkSubmitted
}: {
  claims: readonly PendingClaim[];
  excluded: ReadonlySet<string>;
  sorting?: TableSorting;
  onToggle: (id: string) => void;
  onMarkSubmitted: (claim: PendingClaim) => void;
}) => (
  <Table
    label="Claims waiting to be submitted"
    {...(sorting ? { sorting } : {})}
    head={[
      { label: 'Include', isCompact: true },
      { label: 'Patient', sort: 'patient' },
      { label: 'PCR', isSecondary: true },
      { label: 'Service Date', isSecondary: true, sort: 'service' },
      { label: 'Payer', sort: 'payer' },
      { label: 'Total', isNumeric: true, sort: 'total' },
      { label: 'Readiness', sort: 'readiness' },
      { label: 'Actions', isLabelHidden: true, isCompact: true }
    ]}
  >
    {claims.map((c) => (
      <TableRow key={c.id}>
        <TableCell>
          <input
            type="checkbox"
            aria-label={`Include ${c.patient} in the batch`}
            disabled={c.issues.length > 0}
            checked={!c.issues.length && !excluded.has(c.id)}
            onChange={() => onToggle(c.id)}
            className="accent-primary size-4 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
          />
        </TableCell>
        <TableCell>
          <TextLink to={`/claims/${c.id}`}>{c.patient}</TextLink>
        </TableCell>
        <TableCell isMuted isSecondary>
          {c.pcrNumber ?? emptyValue}
        </TableCell>
        <TableCell kind="date" isMuted isSecondary>
          {c.serviceDate ?? emptyValue}
        </TableCell>
        <TableCell>
          <span className="flex flex-wrap items-center gap-2">
            {c.payer}
            {c.resubmission ? <Badge intent="info">Resubmission</Badge> : null}
          </span>
        </TableCell>
        <TableCell kind="numeric">{formatCents(c.totalCents)}</TableCell>
        <TableCell>
          {c.issues.length ? (
            <ul className="text-warning-fg flex max-w-md min-w-56 list-disc flex-col gap-1 pl-4 text-xs whitespace-normal">
              {c.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : (
            <Badge intent="success">Ready</Badge>
          )}
        </TableCell>
        <TableCell kind="actions">
          <Button variant="outline" size="sm" tooltipSide="left" onClick={() => onMarkSubmitted(c)}>
            <CheckIcon aria-hidden="true" className="size-4" />
            Mark submitted
          </Button>
        </TableCell>
      </TableRow>
    ))}
  </Table>
);

export const BatchesTable = ({
  batches,
  sorting,
  fileUrl
}: {
  batches: readonly Batch[];
  sorting?: TableSorting;
  fileUrl: (id: string) => string;
}) => (
  <Table
    label="837P batches"
    {...(sorting ? { sorting } : {})}
    head={[
      { label: 'Batch', sort: 'control' },
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
          <a
            href={fileUrl(b.id)}
            download
            className={buttonClasses({ variant: 'outline', size: 'sm' })}
          >
            <DownloadIcon aria-hidden="true" className="size-4" />
            Download 837P
          </a>
        </TableCell>
      </TableRow>
    ))}
  </Table>
);

export const SubmissionsPage = ({ client, live }: SubmissionsPageProps) => {
  const pendingTable = useTableState(PATH, PENDING_TABLE);
  const batchTable = useTableState(PATH, BATCH_TABLE);
  const pending = useResource('submissions:pending', client.pending, 30_000);
  const batches = useResource(`submissions:batches:${batchTable.apiQuery}`, () =>
    client.batches(batchTable.apiQuery)
  );
  const reload = () => {
    pending.reload();
    batches.reload();
  };
  useLive(live, (e) => e.kind === 'claim', reload);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState<PendingClaim | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ text: string; batch: Batch | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const claims = pending.data?.claims ?? [];
  const blockers = pending.data?.issues ?? [];
  const ids = selectedIds(claims, excluded);

  const act = async (action: () => Promise<{ text: string; batch: Batch | null }>) => {
    setBusy(true);
    setError('');
    setNotice(null);
    try {
      setNotice(await action());
      setExcluded(new Set());
      reload();
    } catch (err) {
      setError(messageOf(err));
      pending.reload();
    } finally {
      setBusy(false);
    }
  };

  const generate = () =>
    act(async () => {
      const batch = await client.createBatch(ids);
      return {
        text: `Batch #${batch.control_number} holds ${batch.claim_count} ${batch.claim_count === 1 ? 'claim' : 'claims'}. Upload it to your clearinghouse.`,
        batch
      };
    });

  const markSubmitted = (claim: PendingClaim) => {
    setConfirming(null);
    void act(async () => {
      await client.markSubmitted(claim.id);
      return {
        text: `${claim.patient}'s claim to ${claim.payer} is marked submitted.`,
        batch: null
      };
    });
  };

  const toggle = (id: string) => {
    const next = new Set(excluded);
    if (!next.delete(id)) next.add(id);
    setExcluded(next);
  };

  const generateBlocked = blockers.length
    ? 'Finish the billing setup first.'
    : ids.length
      ? undefined
      : 'Select at least one ready claim.';

  return (
    <Page
      title="Submissions"
      description="Claims waiting on their next payer, and the 837P files generated for your clearinghouse."
      actions={
        <Button isPending={busy} disabledReason={generateBlocked} onClick={() => void generate()}>
          <FileCogIcon aria-hidden="true" className="size-4" />
          Generate 837P ({ids.length})
        </Button>
      }
    >
      {blockers.length ? (
        <Alert
          intent="warning"
          action={
            <ButtonLink to="/settings" variant="outline" size="sm">
              Open Settings
            </ButtonLink>
          }
        >
          {blockers.join('. ')}.
        </Alert>
      ) : null}
      {error ? <Alert>{error}</Alert> : null}
      {notice ? (
        <Alert
          intent="success"
          action={
            notice.batch ? (
              <a
                href={client.fileUrl(notice.batch.id)}
                download
                className={buttonClasses({ variant: 'outline', size: 'sm' })}
              >
                <DownloadIcon aria-hidden="true" className="size-4" />
                Download 837P
              </a>
            ) : undefined
          }
        >
          {notice.text}
        </Alert>
      ) : null}
      {pending.error ? <Alert>{pending.error.message}</Alert> : null}
      <Section
        title="Waiting to Be Submitted"
        description="Ready claims on every page are included in the next batch unless you uncheck them."
      >
        {claims.length ? (
          <>
            <PendingTable
              claims={pageOf(claims, pendingTable, PENDING_VALUES).items}
              excluded={excluded}
              sorting={pendingTable}
              onToggle={toggle}
              onMarkSubmitted={setConfirming}
            />
            <Pagination label="Waiting claims" total={claims.length} state={pendingTable} />
          </>
        ) : pending.loading ? (
          <PageLoading />
        ) : (
          <EmptyText reason="clear">No claims are waiting to be submitted.</EmptyText>
        )}
      </Section>
      <Section title="837P Batches" description="Files you have generated, newest first.">
        {batches.error ? <Alert>{batches.error.message}</Alert> : null}
        {batches.data?.items.length ? (
          <>
            <BatchesTable
              batches={batches.data.items}
              sorting={batchTable}
              fileUrl={client.fileUrl}
            />
            <Pagination label="837P batches" total={batches.data.total} state={batchTable} />
          </>
        ) : batches.loading ? (
          <PageLoading />
        ) : (
          <EmptyText>No batches yet.</EmptyText>
        )}
      </Section>
      <ConfirmDialog
        open={confirming !== null}
        title="Mark as Submitted?"
        confirmLabel="Mark submitted"
        confirmIcon={SendIcon}
        onClose={() => setConfirming(null)}
        onConfirm={() => confirming && markSubmitted(confirming)}
      >
        Use this when the claim to {confirming?.payer} went out another way, such as the
        clearinghouse portal or paper. The payer clock starts now.
      </ConfirmDialog>
    </Page>
  );
};
