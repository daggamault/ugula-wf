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
import { Section } from '../../shared/ui/section-panel.tsx';
import { Table, TableCell, TableRow } from '../../shared/ui/table.tsx';
import { TextLink } from '../../shared/ui/text-link.tsx';
import { useResource } from '../../shared/use-resource.ts';
import type { Batch, PendingClaim, SubmissionsClient } from './client.ts';

export type SubmissionsPageProps = {
  client: SubmissionsClient;
  live: Live;
};

export const selectedIds = (claims: readonly PendingClaim[], excluded: ReadonlySet<string>) =>
  claims.filter((c) => !c.issues.length && !excluded.has(c.id)).map((c) => c.id);

export const PendingTable = ({
  claims,
  excluded,
  onToggle,
  onMarkSubmitted
}: {
  claims: readonly PendingClaim[];
  excluded: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onMarkSubmitted: (claim: PendingClaim) => void;
}) => (
  <Table
    label="Claims waiting to be submitted"
    head={[
      { label: 'Include', isCompact: true },
      'Patient',
      { label: 'PCR', isSecondary: true },
      { label: 'Service Date', isSecondary: true },
      'Payer',
      { label: 'Total', isNumeric: true },
      'Readiness',
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
            className="size-4 disabled:opacity-40"
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
            {c.resubmission ? <Badge tone="info">Resubmission</Badge> : null}
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
            <Badge tone="success">Ready</Badge>
          )}
        </TableCell>
        <TableCell kind="actions">
          <Button
            variant="secondary"
            size="sm"
            tooltipSide="left"
            onClick={() => onMarkSubmitted(c)}
          >
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
  fileUrl
}: {
  batches: readonly Batch[];
  fileUrl: (id: string) => string;
}) => (
  <Table
    label="837P batches"
    head={[
      'Batch',
      'Created',
      { label: 'Claims', isNumeric: true },
      { label: 'Total', isNumeric: true },
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
            <Badge tone="success">Production</Badge>
          ) : (
            <Badge tone="warning">Test</Badge>
          )}
        </TableCell>
        <TableCell isMuted isSecondary>
          {b.created_by_email ?? emptyValue}
        </TableCell>
        <TableCell kind="actions">
          <a href={fileUrl(b.id)} download className={buttonClasses('secondary', 'sm')}>
            <DownloadIcon aria-hidden="true" className="size-4" />
            Download 837P
          </a>
        </TableCell>
      </TableRow>
    ))}
  </Table>
);

export const SubmissionsPage = ({ client, live }: SubmissionsPageProps) => {
  const pending = useResource('submissions:pending', client.pending, 30_000);
  const batches = useResource('submissions:batches', client.batches);
  const reload = () => {
    pending.reload();
    batches.reload();
  };
  useLive(live, pending.reload);
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
          tone="warning"
          action={
            <ButtonLink to="/settings" variant="secondary" size="sm">
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
          tone="success"
          action={
            notice.batch ? (
              <a
                href={client.fileUrl(notice.batch.id)}
                download
                className={buttonClasses('secondary', 'sm')}
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
        description="Ready claims are included in the next batch unless you uncheck them."
      >
        {claims.length ? (
          <PendingTable
            claims={claims}
            excluded={excluded}
            onToggle={toggle}
            onMarkSubmitted={setConfirming}
          />
        ) : pending.loading ? (
          <PageLoading />
        ) : (
          <EmptyText reason="clear">No claims are waiting to be submitted.</EmptyText>
        )}
      </Section>
      <Section title="837P Batches" description="Files you have generated, newest first.">
        {batches.error ? <Alert>{batches.error.message}</Alert> : null}
        {batches.data?.length ? (
          <BatchesTable batches={batches.data} fileUrl={client.fileUrl} />
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
