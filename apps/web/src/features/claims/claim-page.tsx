import { type ClaimIssue, isClosedStatus, TRIP_TYPE_LABELS } from '@ugula/billing';
import { UserIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { ChargeLines } from '../../shared/claims/charge-lines.tsx';
import { ClaimIssues } from '../../shared/claims/claim-issues.tsx';
import { downloadText } from '../../shared/download.ts';
import { formatCents, formatDate, formatMiles } from '../../shared/format.ts';
import { type Live, useLive } from '../../shared/live.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { ButtonLink } from '../../shared/ui/button.tsx';
import { Detail, DetailList } from '../../shared/ui/detail-list.tsx';
import { emptyValue } from '../../shared/ui/empty-state.tsx';
import { Page, PageFailure, PageLoading } from '../../shared/ui/page.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { Tabs } from '../../shared/ui/tabs.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { backLabelOf, type Page as ListPage, withBack } from '../../shared/url-state.ts';
import { type Resource, useResource } from '../../shared/use-resource.ts';
import { CycleAlert, OpenTasks } from './claim-cycle.tsx';
import { ClaimDataForm } from './claim-data-form.tsx';
import { DocumentationPanel, EligibilityPanel } from './claim-documentation.tsx';
import { DocumentsPanel } from './claim-documents.tsx';
import { ClaimFiles } from './claim-files.tsx';
import { ClaimHistory, useHistoryTable } from './claim-history.tsx';
import { PayersEditor } from './claim-payers.tsx';
import { ClaimRecovery } from './claim-recovery.tsx';
import { ResponseForm } from './claim-response.tsx';
import { ClaimStatusBadge } from './claim-status-badge.tsx';
import type {
  BillingDataInput,
  ClaimDetail,
  ClaimEvent,
  ClaimLine,
  ClaimPayerFile,
  ClaimProgress,
  ClaimResponseInput,
  ClaimsClient,
  PayerInput
} from './client.ts';

type ClaimPageProps = {
  client: ClaimsClient;
  live: Live;
  me: string;
  claimId: string;
  tab?: ClaimTab;
  back?: string;
};

export const lockedReason = (status: ClaimDetail['status']) =>
  isClosedStatus(status)
    ? 'This claim is closed.'
    : status === 'draft'
      ? 'This claim is still a draft. Finish its PCR tasks first.'
      : undefined;

const pricedLinesOf = (lines: readonly ClaimLine[]) =>
  lines.map((l) => ({
    code: l.code,
    units: Number(l.units),
    unitCents: l.unit_cents,
    totalCents: l.total_cents
  }));

type ClaimLinks = {
  fileUrl: (batchId: string) => string;
  encounterUrl: (reportId: string) => string;
};

export type ClaimTab = 'overview' | 'data' | 'history';

const patientName = (c: Pick<ClaimDetail, 'first_name' | 'last_name'>) =>
  c.last_name ? `${c.last_name}, ${c.first_name ?? ''}` : 'Patient not matched yet';

export const CLAIM_TABS: readonly { value: ClaimTab; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'data', label: 'Claim Data' },
  { value: 'history', label: 'History' }
];

export const ClaimView = ({
  claim,
  files,
  payerFiles = [],
  history,
  progress,
  issues,
  onSavePayers,
  onRecord,
  onRestart,
  onSaveData,
  onCheckEligibility,
  onDownloadEligibility,
  documentUrl,
  submission,
  recovery,
  documents,
  tab = 'overview',
  back = '/claims',
  error = '',
  me = ''
}: {
  claim: ClaimDetail;
  files: readonly ClaimEvent[];
  payerFiles?: readonly ClaimPayerFile[];
  history: Resource<ListPage<ClaimEvent>>;
  progress: ClaimProgress | null;
  issues: readonly ClaimIssue[];
  onSavePayers: (payers: PayerInput[]) => Promise<void>;
  onRecord: (response: ClaimResponseInput) => Promise<boolean>;
  onRestart: () => Promise<void>;
  onSaveData: (data: BillingDataInput) => Promise<boolean>;
  onCheckEligibility: () => Promise<void>;
  onDownloadEligibility: () => Promise<void>;
  documentUrl: (eventId: string) => string;
  submission?: ClaimLinks;
  recovery?: ReactNode;
  documents?: ReactNode;
  tab?: ClaimTab;
  back?: string;
  error?: string;
  me?: string;
}) => {
  const locked = lockedReason(claim.status);
  const path = `/claims/${claim.id}`;
  const current = progress && 'coverage' in progress ? progress.coverage.id : null;
  const coverageKey = JSON.stringify(claim.coverages);
  return (
    <Page
      title={`Claim ${claim.number}`}
      backTo={back}
      backLabel={backLabelOf(back)}
      description={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <ClaimStatusBadge status={claim.status} />
          <span className="text-surface-fg font-medium">{patientName(claim)}</span>
          {claim.patient_number !== null ? <span>Patient {claim.patient_number}</span> : null}
          {claim.encounter_number ? <span>Encounter {claim.encounter_number}</span> : null}
          <span>{claim.pcr_number ? `PCR ${claim.pcr_number}` : 'No PCR number'}</span>
        </span>
      }
      actions={
        claim.patient_id ? (
          <ButtonLink to={`/patients/${claim.patient_id}`} variant="outline">
            <UserIcon aria-hidden="true" className="size-4" />
            Patient
          </ButtonLink>
        ) : null
      }
    >
      {error ? <Alert>{error}</Alert> : null}
      <OpenTasks tasks={claim.tasks} back={withBack(path, back)} me={me} />
      <CycleAlert claim={claim} progress={progress} onRestart={onRestart} />
      <Tabs
        label="Claim sections"
        tabs={CLAIM_TABS.map((t) => ({
          label: t.label,
          href: withBack(t.value === 'overview' ? path : `${path}?tab=${t.value}`, back),
          isSelected: t.value === tab,
          count: t.value === 'history' ? history.data?.total : undefined
        }))}
      />
      {tab === 'overview' ? (
        <>
          {isClosedStatus(claim.status) ? null : <ClaimIssues issues={issues} />}
          <SectionPanel
            title="Summary"
            description="What was billed, what is still owed, and the transport it covers."
          >
            <DetailList>
              <Detail label="Total" isEmphasized>
                {formatCents(claim.total_cents)}
              </Detail>
              <Detail label="Balance" isEmphasized>
                {formatCents(claim.balance_cents)}
              </Detail>
              <Detail label="Service Date">{formatDate(claim.service_date)}</Detail>
              <Detail label="Born">{formatDate(claim.birth_date)}</Detail>
              <Detail label="Trip Type">
                {claim.trip_type ? TRIP_TYPE_LABELS[claim.trip_type] : emptyValue}
              </Detail>
              <Detail label="Transport">
                {claim.level ?? emptyValue}
                {claim.emergency ? ' emergency' : ''}
                {claim.loaded_miles ? (
                  <span className="tabular-nums"> · {formatMiles(claim.loaded_miles)} loaded</span>
                ) : null}
              </Detail>
            </DetailList>
          </SectionPanel>
          <DocumentationPanel claim={claim} />
          {documents}
          <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
            <div className="flex min-w-0 flex-col gap-6">
              <SectionPanel title="Charges" description="Priced from the fee schedule.">
                <ChargeLines lines={pricedLinesOf(claim.lines)} />
              </SectionPanel>
              <PayersEditor
                key={coverageKey}
                coverages={claim.coverages}
                locked={locked}
                onSave={onSavePayers}
              />
              <EligibilityPanel
                coverages={claim.coverages}
                locked={locked}
                onCheck={onCheckEligibility}
                onDownload={onDownloadEligibility}
              />
              {recovery}
              {submission ? (
                <ClaimFiles
                  claim={claim}
                  files={files}
                  payerFiles={payerFiles}
                  back={withBack(path, back)}
                  documentUrl={documentUrl}
                  fileUrl={submission.fileUrl}
                  encounterUrl={submission.encounterUrl}
                />
              ) : null}
            </div>
            <ResponseForm
              key={`response-${coverageKey}`}
              coverages={claim.coverages}
              current={current}
              locked={locked}
              onRecord={onRecord}
            />
          </div>
        </>
      ) : tab === 'data' ? (
        <ClaimDataForm key={`data-${claim.id}`} claim={claim} locked={locked} onSave={onSaveData} />
      ) : (
        <SectionPanel title="History" description="Everything that has happened on this claim.">
          <ClaimHistory
            claimId={claim.id}
            history={history}
            documentUrl={documentUrl}
            fileUrl={submission?.fileUrl}
          />
        </SectionPanel>
      )}
    </Page>
  );
};

export const ClaimPage = ({
  client,
  live,
  me,
  claimId,
  tab = 'overview',
  back = '/claims'
}: ClaimPageProps) => {
  const detail = useResource(`claim:${claimId}`, (signal) => client.find(claimId, signal), 15_000);
  const historyTable = useHistoryTable(claimId);
  const history = useResource(`claim:${claimId}:events:${historyTable.apiQuery}`, (signal) =>
    client.events(claimId, historyTable.apiQuery, signal)
  );
  const cycleRun = detail.data?.claim.cycle_run_id;
  const taskIds = detail.data?.claim.tasks.map((t) => t.id) ?? [];
  const reload = () => {
    detail.reload();
    history.reload();
  };
  useLive(
    live,
    (e) =>
      (e.kind === 'claim' && (e.id === claimId || e.id === null)) ||
      (e.kind === 'run' && e.id === cycleRun) ||
      (e.kind === 'task' && (e.id === null || taskIds.includes(e.id))),
    reload
  );
  const [error, setError] = useState('');
  const notify = useToast();
  const patient = detail.data
    ? `Claim ${detail.data.claim.number} · ${patientName(detail.data.claim)}`
    : '';
  const act = async (action: () => Promise<unknown>, done: string) => {
    setError('');
    try {
      await action();
      reload();
      notify({ title: done, description: patient });
      return true;
    } catch (err) {
      setError(messageOf(err));
      return false;
    }
  };
  if (detail.error) return <PageFailure message={detail.error.message} />;
  if (!detail.data) return <PageLoading />;
  return (
    <ClaimView
      tab={tab}
      back={back}
      me={me}
      error={error}
      claim={detail.data.claim}
      files={detail.data.files}
      payerFiles={detail.data.payerFiles}
      history={history}
      progress={detail.data.progress}
      issues={detail.data.issues}
      onSavePayers={async (payers) => {
        await act(() => client.setPayers(claimId, payers), 'Payers saved');
      }}
      onRecord={(response) => act(() => client.recordResponse(claimId, response), 'Payment posted')}
      onSaveData={(data) =>
        act(() => client.saveBillingData(claimId, data), 'Billing details saved')
      }
      documentUrl={(eventId) => client.documentUrl(claimId, eventId)}
      onCheckEligibility={async () => {
        await act(
          () => client.checkEligibility(claimId),
          'Eligibility check sent to the clearinghouse'
        );
      }}
      onDownloadEligibility={async () => {
        await act(async () => {
          const request = await client.eligibilityRequest(claimId);
          downloadText(request.name, request.file, 'application/edi-x12');
        }, 'Eligibility request (270) downloaded');
      }}
      onRestart={async () => {
        await act(() => client.restartCycle(claimId), 'Payer cycle restarted');
      }}
      submission={{ fileUrl: client.fileUrl, encounterUrl: client.encounterUrl }}
      documents={
        <DocumentsPanel
          documents={detail.data.documents}
          locked={
            isClosedStatus(detail.data.claim.status)
              ? lockedReason(detail.data.claim.status)
              : undefined
          }
          documentUrl={(documentId) => client.claimDocumentUrl(claimId, documentId)}
          onUpload={(kind, signedOn, file) =>
            act(
              () => client.uploadDocument(claimId, { kind, signedOn, file }),
              `${file.name} uploaded`
            )
          }
          onChase={(kind, note) =>
            act(() => client.chaseDocument(claimId, kind, note), 'Document chase started')
          }
        />
      }
      recovery={
        <ClaimRecovery
          client={client}
          claim={detail.data.claim}
          locked={lockedReason(detail.data.claim.status)}
          onChanged={reload}
        />
      }
    />
  );
};
