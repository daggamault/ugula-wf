import type { Adjustment, PaymentOutcome } from '@ugula/billing';
import { formatCents, formatDate } from '../format.ts';
import { Badge } from '../ui/badge.tsx';
import { EmptyText } from '../ui/empty-state.tsx';
import type { Intent } from '../ui/intent.ts';
import { SectionPanel } from '../ui/section-panel.tsx';

export type ClaimPayment = {
  id: string;
  coverage_position: number | null;
  outcome: PaymentOutcome;
  paid_cents: number;
  patient_cents: number;
  adjustments: Adjustment[];
  remarks: string[];
  payer_name: string | null;
  paid_on: string | null;
  trace_number: string | null;
};

const OUTCOMES: Record<PaymentOutcome, [string, Intent]> = {
  paid: ['Paid', 'success'],
  denied: ['Denied', 'danger'],
  forwarded: ['Forwarded', 'info'],
  reversed: ['Reversed', 'warning']
};

export const reasonCodes = (p: Pick<ClaimPayment, 'adjustments' | 'remarks'>) =>
  [
    ...p.adjustments.map((a) => `${a.group}-${a.reason} ${formatCents(a.cents)}`),
    ...p.remarks
  ].join(' · ');

export const PaymentsPanel = ({ payments }: { payments: readonly ClaimPayment[] }) => (
  <SectionPanel title="Payments">
    {payments.length ? (
      <ol className="divide-border border-border flex flex-col divide-y rounded-xl border">
        {payments.map((p) => {
          const [label, intent] = OUTCOMES[p.outcome];
          return (
            <li key={p.id} className="flex flex-col gap-0.5 px-4 py-3 text-sm">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{p.payer_name ?? 'Unknown payer'}</span>
                <Badge intent={intent}>{label}</Badge>
                <span className="text-surface-fg-muted text-xs">{formatDate(p.paid_on)}</span>
              </span>
              <span className="text-xs tabular-nums">
                Paid {formatCents(p.paid_cents)} · patient owes {formatCents(p.patient_cents)}
                {p.trace_number ? ` · ${p.trace_number}` : ''}
              </span>
              {reasonCodes(p) ? (
                <span className="text-surface-fg-muted text-xs">{reasonCodes(p)}</span>
              ) : null}
            </li>
          );
        })}
      </ol>
    ) : (
      <EmptyText>No payer has paid or denied this claim yet.</EmptyText>
    )}
  </SectionPanel>
);
