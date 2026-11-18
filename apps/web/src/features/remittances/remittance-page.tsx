import { formatCents, formatDate, formatDateTime, patientName } from '../../shared/format.ts';
import { type Live, useReconnect } from '../../shared/live.ts';
import { Badge } from '../../shared/ui/badge.tsx';
import { Detail, DetailList } from '../../shared/ui/detail-list.tsx';
import { EmptyText, emptyValue } from '../../shared/ui/empty-state.tsx';
import { OpenLink, RowActions } from '../../shared/ui/icon-button.tsx';
import type { Intent } from '../../shared/ui/intent.ts';
import { Page, PageFailure, PageLoading } from '../../shared/ui/page.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { Table, TableCell, TableRow } from '../../shared/ui/table.tsx';
import { backLabelOf, withBack } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import type { Remittance, RemittancePayment, RemittancesClient } from './client.ts';
import { REMITTANCES_PATH, RemittanceState, remittanceName } from './remittances-page.tsx';

const OUTCOMES: Record<RemittancePayment['outcome'], [string, Intent]> = {
  paid: ['Paid', 'success'],
  denied: ['Denied', 'danger'],
  forwarded: ['Forwarded', 'info'],
  reversed: ['Reversed', 'warning']
};

export const adjustmentText = (p: Pick<RemittancePayment, 'adjustments' | 'remarks'>) =>
  [
    ...p.adjustments.map((a) => `${a.group}-${a.reason} ${formatCents(a.cents)}`),
    ...p.remarks
  ].join(' · ');

export const RemittanceSummaryPanel = ({ remittance: r }: { remittance: Remittance }) => (
  <SectionPanel title="Payment">
    <DetailList>
      <Detail label="Amount" isEmphasized>
        {formatCents(r.total_cents)}
      </Detail>
      <Detail label="State">
        <RemittanceState remittance={r} />
      </Detail>
      <Detail label="Paid">{formatDate(r.paid_on)}</Detail>
      <Detail label="Trace Number">{r.trace_number ?? emptyValue}</Detail>
      <Detail label="Claim Payments">{formatCents(r.claim_paid_cents)}</Detail>
      <Detail label="Provider Adjustments">{formatCents(r.provider_adjustment_cents)}</Detail>
      <Detail label="Balances">{r.is_balanced ? 'Yes' : 'No'}</Detail>
      <Detail label="Unmatched Payments">{r.unmatched_count}</Detail>
      <Detail label="File">{r.file_name}</Detail>
      {r.reconciled_at ? (
        <>
          <Detail label="Reconciled">{formatDateTime(r.reconciled_at)}</Detail>
          <Detail label="Reconciled By">{r.reconciled_by ?? 'Automatically'}</Detail>
          <Detail label="Note">{r.reconcile_note ?? emptyValue}</Detail>
        </>
      ) : null}
    </DetailList>
  </SectionPanel>
);

export const PaymentsTable = ({
  payments,
  back
}: {
  payments: readonly RemittancePayment[];
  back: string;
}) =>
  payments.length ? (
    <Table
      label="Claim Payments"
      head={[
        { label: 'Claim' },
        { label: 'Outcome' },
        { label: 'Charged' },
        { label: 'Paid' },
        { label: 'Patient Owes' },
        { label: 'Reasons', isSecondary: true },
        { label: 'Actions', isLabelHidden: true, isCompact: true }
      ]}
    >
      {payments.map((p) => {
        const [label, intent] = OUTCOMES[p.outcome];
        return (
          <TableRow key={p.id}>
            <TableCell>
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">{p.claim_number}</span>
                <span className="text-surface-fg-muted text-xs">
                  {p.claim_id
                    ? (patientName(p.last_name, p.first_name) ?? 'Unnamed patient')
                    : 'Matched no claim'}
                </span>
              </span>
            </TableCell>
            <TableCell>
              <Badge intent={p.claim_id ? intent : 'warning'}>
                {p.claim_id ? label : 'Unmatched'}
              </Badge>
            </TableCell>
            <TableCell kind="numeric">{formatCents(p.charge_cents)}</TableCell>
            <TableCell kind="numeric">{formatCents(p.paid_cents)}</TableCell>
            <TableCell kind="numeric">{formatCents(p.patient_cents)}</TableCell>
            <TableCell isMuted isSecondary>
              {adjustmentText(p) || emptyValue}
            </TableCell>
            <TableCell kind="actions">
              {p.claim_id ? (
                <RowActions>
                  <OpenLink
                    to={withBack(`/claims/${p.claim_id}`, back)}
                    name={`Claim ${p.claim_number}`}
                  />
                </RowActions>
              ) : null}
            </TableCell>
          </TableRow>
        );
      })}
    </Table>
  ) : (
    <EmptyText>This remittance pays no claims.</EmptyText>
  );

type RemittancePageProps = {
  client: RemittancesClient;
  live: Live;
  remittanceId: string;
  back?: string;
};

export const RemittancePage = ({
  client,
  live,
  remittanceId,
  back = REMITTANCES_PATH
}: RemittancePageProps) => {
  const detail = useResource(`remittance:${remittanceId}`, (signal) =>
    client.find(remittanceId, signal)
  );
  useReconnect(live, detail.reload);
  if (detail.error) return <PageFailure message={detail.error.message} />;
  if (!detail.data) return <PageLoading />;
  const { remittance, payments } = detail.data;
  return (
    <Page title={remittanceName(remittance)} backTo={back} backLabel={backLabelOf(back)}>
      <RemittanceSummaryPanel remittance={remittance} />
      <SectionPanel title="Claim Payments">
        <PaymentsTable
          payments={payments}
          back={withBack(`${REMITTANCES_PATH}/${remittanceId}`, back)}
        />
      </SectionPanel>
    </Page>
  );
};
