import {
  CLASSIFICATION_LABELS,
  type ClaimIssue,
  type ClaimTaskKey,
  isClosedStatus
} from '@ugula/billing';
import { UserIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useCan } from '../../shared/access.tsx';
import { messageOf } from '../../shared/api.ts';
import { ChargeLines } from '../../shared/claims/charge-lines.tsx';
import { ClaimIssues } from '../../shared/claims/claim-issues.tsx';
import { downloadText } from '../../shared/download.ts';
import { formatCents, formatDate, formatMiles } from '../../shared/format.ts';
import { type Live, useLive } from '../../shared/live.ts';
import { navigate } from '../../shared/router.tsx';
import { Alert } from '../../shared/ui/alert.tsx';
import { ButtonLink } from '../../shared/ui/button.tsx';
import { Detail, DetailList } from '../../shared/ui/detail-list.tsx';
import { emptyValue } from '../../shared/ui/empty-state.tsx';
import { Menu } from '../../shared/ui/menu.tsx';
import { Page, PageFailure, PageLoading } from '../../shared/ui/page.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { Tabs } from '../../shared/ui/tabs.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { backLabelOf, type Page as ListPage, withBack } from '../../shared/url-state.ts';
import { type Resource, useResource } from '../../shared/use-resource.ts';
import { CycleAlert, OpenTasks } from './claim-cycle.tsx';
import { ClaimDataView } from './claim-data.tsx';
import { DocumentationPanel, EligibilityPanel } from './claim-documentation.tsx';
import { DocumentsPanel } from './claim-documents.tsx';
import { ClaimFiles } from './claim-files.tsx';
import { ClaimHistory, useHistoryTable } from './claim-history.tsx';
import { PayersPanel } from './claim-payers.tsx';
import { ClaimStatusBadge } from './claim-status-badge.tsx';
import { claimTaskGroups, START_TASK_ICON, waitForTask } from './claim-tasks.tsx';
import type {
  ClaimDetail,
  ClaimDocument,
  ClaimEvent,
  ClaimLine,
  ClaimPayerFile,
  ClaimProgress,
  ClaimsClient
} from './client.ts';

type ClaimPageProps = {
  client: ClaimsClient;
  live: Live;
  me: string;
  claimId: string;
  tab?: ClaimTab;
  back?: string;
};

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
  documents = [],
  onDownloadEligibility,
  documentUrl,
  claimDocumentUrl = () => '',
  submission,
  startTask,
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
  documents?: readonly ClaimDocument[];
  onDownloadEligibility: () => Promise<void>;
  documentUrl: (eventId: string) => string;
  claimDocumentUrl?: (documentId: string) => string;
  submission?: ClaimLinks;
  startTask?: ReactNode;
  tab?: ClaimTab;
  back?: string;
  error?: string;
  me?: string;
}) => {
  const path = `/claims/${claim.id}`;
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
        <>
          {claim.patient_id ? (
            <ButtonLink to={`/patients/${claim.patient_id}`} variant="outline">
              <UserIcon aria-hidden="true" className="size-4" />
              Patient
            </ButtonLink>
          ) : null}
          {startTask}
        </>
      }
    >
      {error ? <Alert>{error}</Alert> : null}
      <OpenTasks tasks={claim.tasks} back={withBack(path, back)} me={me} />
      <CycleAlert claim={claim} progress={progress} />
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
              <Detail label="Classification">
                {claim.classification ? CLASSIFICATION_LABELS[claim.classification] : emptyValue}
              </Detail>
              <Detail label="Transport">
                {claim.level ?? emptyValue}
                {claim.emergency ? ' emergency' : ''}
                {claim.loaded_miles ? (
                  <span className="tabular-nums"> · {formatMiles(claim.loaded_miles)} loaded</span>
                ) : null}
              </Detail>
              <Detail label="Responsible Facility">
                {claim.facility_name ?? 'None: the payers and the patient'}
              </Detail>
            </DetailList>
          </SectionPanel>
          <DocumentationPanel claim={claim} />
          <DocumentsPanel documents={documents} documentUrl={claimDocumentUrl} />
          <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
            <div className="flex min-w-0 flex-col gap-6">
              <SectionPanel title="Charges" description="Priced from the fee schedule.">
                <ChargeLines lines={pricedLinesOf(claim.lines)} />
              </SectionPanel>
              <PayersPanel coverages={claim.coverages} />
            </div>
            <div className="flex min-w-0 flex-col gap-6">
              <EligibilityPanel coverages={claim.coverages} onDownload={onDownloadEligibility} />
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
          </div>
        </>
      ) : tab === 'data' ? (
        <ClaimDataView claim={claim} />
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
  const [starting, setStarting] = useState(false);
  const notify = useToast();
  const can = useCan();
  const path = withBack(`/claims/${claimId}`, back);
  const patient = detail.data
    ? `Claim ${detail.data.claim.number} · ${patientName(detail.data.claim)}`
    : '';
  const act = async (action: () => Promise<unknown>, done: string) => {
    setError('');
    setStarting(true);
    try {
      await action();
      reload();
      notify({ title: done, description: patient });
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setStarting(false);
    }
  };
  const start = async (key: ClaimTaskKey) => {
    setError('');
    setStarting(true);
    try {
      const { runId } = await client.startTask(claimId, key);
      const taskId = await waitForTask(() => client.runTask(runId));
      if (taskId) navigate(withBack(`/tasks/${taskId}`, path));
      else {
        reload();
        notify({
          intent: 'info',
          title: 'The task is still opening',
          description: 'It shows on this claim as soon as it is ready.'
        });
      }
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setStarting(false);
    }
  };
  if (detail.error) return <PageFailure message={detail.error.message} />;
  if (!detail.data) return <PageLoading />;
  const { claim, progress } = detail.data;
  return (
    <ClaimView
      tab={tab}
      back={back}
      me={me}
      error={error}
      claim={claim}
      files={detail.data.files}
      payerFiles={detail.data.payerFiles}
      documents={detail.data.documents}
      history={history}
      progress={progress}
      issues={detail.data.issues}
      documentUrl={(eventId) => client.documentUrl(claimId, eventId)}
      claimDocumentUrl={(documentId) => client.claimDocumentUrl(claimId, documentId)}
      onDownloadEligibility={() =>
        act(async () => {
          const request = await client.eligibilityRequest(claimId);
          downloadText(request.name, request.file, 'application/edi-x12');
        }, 'Eligibility request (270) downloaded')
      }
      submission={{ fileUrl: client.fileUrl, encounterUrl: client.encounterUrl }}
      startTask={
        can('claims:update') ? (
          <Menu
            label="Start Task"
            icon={START_TASK_ICON}
            isPending={starting}
            groups={claimTaskGroups(claim, progress, {
              onStart: (key) => void start(key),
              onCheckEligibility: () =>
                void act(
                  () => client.checkEligibility(claimId),
                  'Eligibility check sent to the clearinghouse'
                ),
              onRestart: () => void act(() => client.restartCycle(claimId), 'Payer cycle restarted')
            })}
          />
        ) : null
      }
    />
  );
};
