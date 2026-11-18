import type { CodeDescriptions } from '@ugula/billing';
import { UserIcon } from 'lucide-react';
import { ChargeLines } from '../../shared/claims/charge-lines.tsx';
import { ClaimDataView } from '../../shared/claims/claim-data.tsx';
import type { ClaimDetail } from '../../shared/claims/claim-detail.ts';
import { EncounterPanel } from '../../shared/claims/claim-encounter.tsx';
import { PayersPanel } from '../../shared/claims/claim-payers.tsx';
import { ClaimStatusBadge } from '../../shared/claims/claim-status-badge.tsx';
import { ClaimSummaryPanel, ReasonsPanel } from '../../shared/claims/claim-summary.tsx';
import { patientName } from '../../shared/format.ts';
import { type Live, useLive } from '../../shared/live.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { ButtonLink } from '../../shared/ui/button.tsx';
import { Page, PageFailure, PageLoading } from '../../shared/ui/page.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { Tabs } from '../../shared/ui/tabs.tsx';
import { backLabelOf, withBack } from '../../shared/url-state.ts';
import { loadFailure, refreshFailure, useResource } from '../../shared/use-resource.ts';
import type { ClaimsClient } from './client.ts';

type ClaimPageProps = {
  client: ClaimsClient;
  live: Live;
  claimId: string;
  tab?: ClaimTab;
  back?: string;
};

export type ClaimTab = 'overview' | 'data';

const patientOf = (c: Pick<ClaimDetail, 'first_name' | 'last_name'>) =>
  patientName(c.last_name, c.first_name) ?? 'Unnamed patient';

export const CLAIM_TABS: readonly { value: ClaimTab; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'data', label: 'Claim Data' }
];

export const ClaimView = ({
  claim,
  codes,
  tab = 'overview',
  back = '/claims',
  error = ''
}: {
  claim: ClaimDetail;
  codes: CodeDescriptions;
  tab?: ClaimTab;
  back?: string;
  error?: string;
}) => {
  const path = `/claims/${claim.id}`;
  return (
    <Page
      title={`Claim ${claim.number}`}
      backTo={back}
      backLabel={backLabelOf(back)}
      description={
        <span className="flex flex-wrap items-center gap-2">
          <ClaimStatusBadge status={claim.status} />
          <span className="text-surface-fg font-medium">{patientOf(claim)}</span>
          {claim.patient_number !== null ? <span>Patient {claim.patient_number}</span> : null}
        </span>
      }
      actions={
        <ButtonLink to={`/patients/${claim.patient_id}`} variant="outline">
          <UserIcon aria-hidden="true" className="size-4" />
          Patient
        </ButtonLink>
      }
    >
      {error ? <Alert>{error}</Alert> : null}
      <Tabs
        label="Claim sections"
        tabs={CLAIM_TABS.map((t) => ({
          label: t.label,
          href: withBack(t.value === 'overview' ? path : `${path}?tab=${t.value}`, back),
          isSelected: t.value === tab
        }))}
      />
      {tab === 'overview' ? (
        <>
          <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
            <ClaimSummaryPanel claim={claim} />
            <ReasonsPanel reasons={claim.reasons} />
          </div>
          <EncounterPanel claim={claim} />
          <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
            <SectionPanel title="Charges">
              <ChargeLines lines={claim.lines} codes={codes} />
            </SectionPanel>
            <PayersPanel coverages={claim.coverages} />
          </div>
        </>
      ) : (
        <ClaimDataView claim={claim} codes={codes} />
      )}
    </Page>
  );
};

export const ClaimPage = ({
  client,
  live,
  claimId,
  tab = 'overview',
  back = '/claims'
}: ClaimPageProps) => {
  const detail = useResource(`claim:${claimId}`, (signal) => client.find(claimId, signal), 15_000);
  useLive(live, (e) => e.kind === 'claim' && (e.id === claimId || e.id === null), detail.reload);
  const failed = loadFailure(detail);
  if (failed) return <PageFailure message={failed.message} />;
  if (!detail.data) return <PageLoading />;
  return (
    <ClaimView
      tab={tab}
      back={back}
      error={refreshFailure(detail)}
      claim={detail.data.claim}
      codes={detail.data.codes}
    />
  );
};
