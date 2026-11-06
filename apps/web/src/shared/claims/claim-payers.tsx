import { RELATIONSHIP_LABELS, SELF } from '@ugula/billing';
import { classNamesOf } from '../class-names.ts';
import { Link } from '../router.tsx';
import { Badge } from '../ui/badge.tsx';
import { EmptyText } from '../ui/empty-state.tsx';
import { interactiveClasses } from '../ui/interactive.ts';
import { SectionPanel } from '../ui/section-panel.tsx';
import type { ClaimCoverage } from './claim-detail.ts';

export const insuredText = (
  c: Pick<ClaimCoverage, 'relationship' | 'insured_first_name' | 'insured_last_name'>
) =>
  c.relationship === SELF
    ? 'Patient is the insured'
    : `Insured: ${[c.insured_first_name, c.insured_last_name].filter(Boolean).join(' ') || 'name missing'} (patient is the ${RELATIONSHIP_LABELS[c.relationship].toLowerCase()})`;

export const coverageIds = (c: Pick<ClaimCoverage, 'member_id' | 'group_id'>) =>
  [
    c.member_id ? `Member ID ${c.member_id}` : 'No member ID',
    c.group_id ? `group ${c.group_id}` : null
  ]
    .filter(Boolean)
    .join(' · ');

export const PayersPanel = ({ coverages }: { coverages: readonly ClaimCoverage[] }) => (
  <SectionPanel
    title="Payers"
    description="Billed in this order, with the patient billed after the last payer."
  >
    {coverages.length ? (
      <ol className="divide-border border-border flex flex-col divide-y rounded-xl border">
        {coverages.map((c, i) => (
          <li key={c.id} className="flex flex-col gap-0.5 px-4 py-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden="true"
                className="bg-primary/10 text-primary min-w-5 shrink-0 rounded-full px-1.5 text-center text-xs/5 font-semibold tabular-nums"
              >
                {i + 1}
              </span>
              <span className="truncate font-medium">
                <span className="sr-only">{i + 1}. </span>
                {c.payer}
              </span>
              {c.payer_id === null ? (
                <Link
                  to="/payers"
                  className={classNamesOf(
                    interactiveClasses,
                    'shrink-0 rounded-full hover:underline'
                  )}
                >
                  <Badge intent="warning">Not in Payer Directory</Badge>
                </Link>
              ) : null}
            </span>
            <span className="text-surface-fg-muted text-xs">
              {coverageIds(c)} · {insuredText(c)}
            </span>
          </li>
        ))}
      </ol>
    ) : (
      <EmptyText>No payers yet. The patient will be billed directly.</EmptyText>
    )}
  </SectionPanel>
);
