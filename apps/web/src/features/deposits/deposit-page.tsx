import { formatCents, formatDate, formatDateTime } from '../../shared/format.ts';
import { type Live, useLive } from '../../shared/live.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { Detail, DetailList } from '../../shared/ui/detail-list.tsx';
import { emptyValue } from '../../shared/ui/empty-state.tsx';
import { Page, PageFailure, PageLoading } from '../../shared/ui/page.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { TextLink } from '../../shared/ui/text-link.tsx';
import { useResource } from '../../shared/use-resource.ts';
import type { Deposit, DepositsClient } from './client.ts';

const DepositMatch = ({ deposit }: { deposit: Deposit }) =>
  deposit.payer_file_id ? (
    <DetailList>
      <Detail label="Remittance">
        <TextLink to={`/payer-files/${deposit.payer_file_id}`}>{deposit.file_name}</TextLink>
      </Detail>
      <Detail label="Payment">
        {deposit.payment_cents === null ? emptyValue : formatCents(deposit.payment_cents)}
      </Detail>
      <Detail label="Paid On">{formatDate(deposit.paid_on)}</Detail>
    </DetailList>
  ) : (
    <Alert intent="warning">
      This deposit has not been matched to a remittance yet. Reconcile Deposit matches it when an
      835 with the same trace number and amount arrives; one with the same trace number but a
      different amount goes to a biller as a task.
    </Alert>
  );

export const DepositPage = ({
  client,
  live,
  depositId,
  back
}: {
  client: DepositsClient;
  live: Live;
  depositId: string;
  back: string;
}) => {
  const deposit = useResource(`deposit:${depositId}`, (signal) =>
    client.deposit(depositId, signal)
  );
  useLive(live, (e) => e.kind === 'payerFile', deposit.reload);
  if (deposit.error) return <PageFailure message={deposit.error.message} />;
  if (!deposit.data) return <PageLoading />;
  const d = deposit.data;
  return (
    <Page title={`Deposit ${d.trace_number}`} backTo={back} backLabel="Back to Deposits">
      <SectionPanel title="Deposit">
        <DetailList>
          <Detail label="Amount" isEmphasized>
            {formatCents(d.amount_cents)}
          </Detail>
          <Detail label="Deposited On">{formatDate(d.deposited_on)}</Detail>
          <Detail label="Payer">{d.payer_name ?? emptyValue}</Detail>
          <Detail label="Recorded">
            {formatDateTime(d.created_at)}
            {d.created_by ? ` · ${d.created_by}` : ''}
          </Detail>
          <Detail label="Note">{d.note ?? emptyValue}</Detail>
        </DetailList>
      </SectionPanel>
      <SectionPanel title="Remittance">
        <DepositMatch deposit={d} />
      </SectionPanel>
    </Page>
  );
};
