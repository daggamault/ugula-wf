import { DownloadIcon } from 'lucide-react';
import { formatCents, formatDateTime } from '../../shared/format.ts';
import { type Live, useLive } from '../../shared/live.ts';
import { OUTCOME_STYLES } from '../../shared/payer-file-outcomes.ts';
import { Badge } from '../../shared/ui/badge.tsx';
import { buttonClasses } from '../../shared/ui/button.tsx';
import { Detail, DetailList } from '../../shared/ui/detail-list.tsx';
import { EmptyText, emptyValue } from '../../shared/ui/empty-state.tsx';
import { OpenLink } from '../../shared/ui/icon-button.tsx';
import { Page, PageFailure, PageLoading } from '../../shared/ui/page.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { Table, TableCell, TableRow } from '../../shared/ui/table.tsx';
import { useResource } from '../../shared/use-resource.ts';
import type { PayerFileItem, PayerFilesClient } from './client.ts';
import { fileStatus, kindOf } from './payer-files.ts';

const amount = (cents: number | null) => (cents === null ? emptyValue : formatCents(cents));

export const PayerFileItems = ({ items }: { items: readonly PayerFileItem[] }) => (
  <Table
    label="Lines in this file"
    head={[
      { label: '#', isCompact: true },
      { label: 'Claim' },
      { label: 'Outcome' },
      { label: 'Paid' },
      { label: 'Adjusted', isSecondary: true },
      { label: 'Details' },
      { label: 'Actions', isLabelHidden: true, isCompact: true }
    ]}
  >
    {items.map((i) => {
      const style = OUTCOME_STYLES[i.outcome];
      return (
        <TableRow key={i.position}>
          <TableCell isMuted>{i.position}</TableCell>
          <TableCell>{i.claim_number === null ? i.reference : i.claim_number}</TableCell>
          <TableCell>
            <Badge intent={style.intent}>{style.label}</Badge>
          </TableCell>
          <TableCell kind="numeric">{amount(i.paid_cents)}</TableCell>
          <TableCell kind="numeric" isSecondary>
            {amount(i.adjusted_cents)}
          </TableCell>
          <TableCell kind="wrap" isMuted={!i.message}>
            {i.message || emptyValue}
          </TableCell>
          <TableCell kind="actions">
            {i.claim_id ? (
              <OpenLink
                to={`/claims/${i.claim_id}`}
                name={`claim ${i.claim_number ?? i.reference}`}
              />
            ) : null}
          </TableCell>
        </TableRow>
      );
    })}
  </Table>
);

export const PayerFilePage = ({
  client,
  live,
  fileId,
  back = '/payer-files'
}: {
  client: PayerFilesClient;
  live: Live;
  fileId: string;
  back?: string;
}) => {
  const found = useResource(`payer-file:${fileId}`, (signal) => client.find(fileId, signal));
  useLive(
    live,
    (e) => e.kind === 'claim' && (found.data?.items ?? []).some((i) => i.claim_id === e.id),
    found.reload
  );
  if (found.error) return <PageFailure message={found.error.message} />;
  if (!found.data) return <PageLoading />;
  const { file, items } = found.data;
  const status = fileStatus(file);
  return (
    <Page
      title={file.file_name}
      backTo={back}
      backLabel="Back to Payer Files"
      description={
        <span className="flex flex-wrap items-center gap-2">
          <Badge intent={status.intent}>{status.label}</Badge>
          <span>
            {kindOf(file)} · {formatDateTime(file.created_at)}
            {file.uploaded_by ? ` · ${file.uploaded_by}` : ''}
          </span>
        </span>
      }
      actions={
        <a
          href={client.fileHref(fileId)}
          download
          className={buttonClasses({ variant: 'outline' })}
        >
          <DownloadIcon aria-hidden="true" className="size-4" />
          Download File
        </a>
      }
    >
      <SectionPanel title="Summary">
        <DetailList>
          <Detail label="Lines" isEmphasized>
            {file.item_count}
          </Detail>
          <Detail label="Need a Biller" isEmphasized>
            {file.problem_count}
          </Detail>
          <Detail label="Control Number">{file.control_number ?? emptyValue}</Detail>
        </DetailList>
      </SectionPanel>
      <SectionPanel title="Lines">
        {items.length ? (
          <PayerFileItems items={items} />
        ) : (
          <EmptyText>This file had nothing for your claims.</EmptyText>
        )}
      </SectionPanel>
    </Page>
  );
};
