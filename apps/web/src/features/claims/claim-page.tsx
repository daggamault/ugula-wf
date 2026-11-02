import { isClosedStatus } from '@ugula/billing';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileCogIcon,
  FileTextIcon,
  ListTodoIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  SaveIcon,
  SendIcon,
  Trash2Icon,
  UserIcon
} from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { classNamesOf } from '../../shared/class-names.ts';
import { formatCents, formatDate, formatDateTime, parseDollars } from '../../shared/format.ts';
import { type Live, useLive } from '../../shared/live.ts';
import { Link } from '../../shared/router.tsx';
import { Alert } from '../../shared/ui/alert.tsx';
import { Badge } from '../../shared/ui/badge.tsx';
import { Button, ButtonLink, buttonClasses } from '../../shared/ui/button.tsx';
import { Detail, DetailList } from '../../shared/ui/detail-list.tsx';
import { ConfirmDialog } from '../../shared/ui/dialog.tsx';
import { EmptyText, emptyValue } from '../../shared/ui/empty-state.tsx';
import { IconButton } from '../../shared/ui/icon-button.tsx';
import { Input } from '../../shared/ui/input.tsx';
import type { Intent } from '../../shared/ui/intent.ts';
import { interactiveClasses } from '../../shared/ui/interactive.ts';
import { Page, PageFailure, PageLoading } from '../../shared/ui/page.tsx';
import { Pagination } from '../../shared/ui/pagination.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { Select } from '../../shared/ui/select.tsx';
import { Table, TableCell, TableRow, type TableSorting } from '../../shared/ui/table.tsx';
import { Tabs } from '../../shared/ui/tabs.tsx';
import { textLinkClasses } from '../../shared/ui/text-link.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { pageOf, useTableState } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import { ClaimDataForm } from './claim-data-form.tsx';
import { ClaimStatusBadge } from './claim-status-badge.tsx';
import { claimNumber } from './claims-page.tsx';
import type {
  Batch,
  BillingDataInput,
  ClaimCoverage,
  ClaimDetail,
  ClaimEvent,
  ClaimLine,
  ClaimProgress,
  ClaimResponseInput,
  ClaimsClient
} from './client.ts';

export type ClaimPageProps = {
  client: ClaimsClient;
  live: Live;
  claimId: string;
  tab?: ClaimTab;
};

const EVENT_LABELS: Record<ClaimEvent['kind'], string> = {
  approved: 'Approved for submission',
  submitted: 'Submitted',
  follow_up: 'Followed up',
  resubmitted: 'Resubmitted',
  resubmit_queued: 'Resubmission queued',
  response: 'Response',
  reconciled: 'Payment reconciled',
  payer_skipped: 'Payer skipped',
  statement: 'Patient statement',
  revised: 'Updated PCR received',
  closed: 'Closed'
};

export const lockedReason = (status: ClaimDetail['status']) =>
  isClosedStatus(status)
    ? 'This claim is closed.'
    : status === 'draft'
      ? 'This claim is still a draft. Finish its PCR tasks first.'
      : undefined;

export const BatchDownload = ({ batch, href }: { batch: Batch; href: string }) => (
  <a href={href} download className={buttonClasses({ variant: 'outline' })}>
    <DownloadIcon aria-hidden="true" className="size-4" />
    Download #{batch.control_number}
  </a>
);

const fileLinkClasses = `inline-flex items-center gap-2 whitespace-nowrap ${textLinkClasses}`;

export const ClaimFiles = ({
  claim,
  events,
  documentUrl,
  fileUrl,
  encounterUrl
}: {
  claim: Pick<ClaimDetail, 'import_report_id' | 'pcr_number'>;
  events: readonly ClaimEvent[];
  documentUrl: (eventId: string) => string;
  fileUrl: (batchId: string) => string;
  encounterUrl: (reportId: string) => string;
}) => {
  const batches = events.filter((e) => e.batch_id);
  const documents = events.filter((e) => e.has_document);
  return (
    <SectionPanel
      title="Files"
      description="The encounter this claim came from, and every 837P file and document sent for it."
    >
      <ul className="flex flex-col gap-2 text-sm">
        <li>
          {claim.import_report_id ? (
            <a href={encounterUrl(claim.import_report_id)} download className={fileLinkClasses}>
              <DownloadIcon aria-hidden="true" className="size-4" />
              Encounter {claim.pcr_number ?? ''} (NEMSIS XML)
            </a>
          ) : (
            <span className="text-surface-fg-muted">No source encounter file.</span>
          )}
        </li>
        {batches.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-2">
            <a href={fileUrl(e.batch_id ?? '')} download className={fileLinkClasses}>
              <DownloadIcon aria-hidden="true" className="size-4" />
              837P file #{e.batch_number}
            </a>
            <span className="text-surface-fg-muted">
              {e.payer} · {formatDateTime(e.created_at)}
            </span>
          </li>
        ))}
        {documents.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-2">
            <a href={documentUrl(e.id)} target="_blank" rel="noopener" className={fileLinkClasses}>
              <FileTextIcon aria-hidden="true" className="size-4" />
              {e.note || EVENT_LABELS[e.kind]}
            </a>
            <span className="text-surface-fg-muted">{formatDateTime(e.created_at)}</span>
          </li>
        ))}
      </ul>
    </SectionPanel>
  );
};

export const moveItem = (items: readonly string[], from: number, to: number) => {
  if (to < 0 || to >= items.length) return [...items];
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
};

export const toResponse = (draft: {
  coverageId: string;
  paid: string;
  adjusted: string;
  note: string;
}): Omit<ClaimResponseInput, 'requestId'> | string => {
  const paidCents = parseDollars(draft.paid || '0');
  const adjustedCents = parseDollars(draft.adjusted || '0');
  if (paidCents === null || adjustedCents === null) return 'Enter amounts of zero or more';
  if (paidCents + adjustedCents === 0 && draft.coverageId === '') {
    return 'A patient payment needs an amount';
  }
  return {
    coverageId: draft.coverageId || null,
    paidCents,
    adjustedCents,
    note: draft.note.trim()
  };
};

export const amountOf = (e: Pick<ClaimEvent, 'paid_cents' | 'adjusted_cents'>) =>
  [
    e.paid_cents ? `${formatCents(e.paid_cents)} paid` : '',
    e.adjusted_cents ? `${formatCents(e.adjusted_cents)} adjusted` : ''
  ]
    .filter(Boolean)
    .join(' · ');

export const LinesTable = ({ lines }: { lines: readonly ClaimLine[] }) => (
  <Table
    label="Claim lines"
    head={[
      'HCPCS',
      { label: 'Units', isNumeric: true },
      { label: 'Unit Price', isNumeric: true },
      { label: 'Amount', isNumeric: true }
    ]}
  >
    {lines.map((l) => (
      <TableRow key={l.position}>
        <TableCell>
          <span className="font-mono font-semibold">{l.code}</span>
        </TableCell>
        <TableCell kind="numeric">{l.units}</TableCell>
        <TableCell kind="numeric" isMuted>
          {formatCents(l.unit_cents)}
        </TableCell>
        <TableCell kind="numeric">{formatCents(l.total_cents)}</TableCell>
      </TableRow>
    ))}
  </Table>
);

export const HISTORY_TABLE = {
  prefix: 'history',
  sorts: { when: 'desc', event: 'asc', payer: 'asc', amount: 'desc' },
  sort: 'when'
} as const;

export const HISTORY_VALUES = {
  when: (e: ClaimEvent) => e.created_at,
  event: (e: ClaimEvent) => EVENT_LABELS[e.kind],
  payer: (e: ClaimEvent) => e.payer,
  amount: (e: ClaimEvent) => e.paid_cents + e.adjusted_cents
};

const ClaimHistory = ({
  claimId,
  events,
  documentUrl,
  fileUrl
}: {
  claimId: string;
  events: readonly ClaimEvent[];
  documentUrl: (eventId: string) => string;
  fileUrl?: ((batchId: string) => string) | undefined;
}) => {
  const table = useTableState(`/claims/${claimId}`, HISTORY_TABLE);
  return (
    <>
      <EventsTable
        events={pageOf(events, table, HISTORY_VALUES).items}
        sorting={table}
        documentUrl={documentUrl}
        fileUrl={fileUrl}
      />
      <Pagination label="Claim history" total={events.length} state={table} />
    </>
  );
};

export const EventsTable = ({
  events,
  sorting,
  documentUrl,
  fileUrl
}: {
  events: readonly ClaimEvent[];
  sorting?: TableSorting;
  documentUrl: (eventId: string) => string;
  fileUrl?: ((batchId: string) => string) | undefined;
}) => (
  <Table
    label="Claim history"
    {...(sorting ? { sorting } : {})}
    head={[
      { label: 'When', sort: 'when' },
      { label: 'Event', sort: 'event' },
      { label: 'Payer', sort: 'payer' },
      { label: 'Amount', sort: 'amount' },
      { label: 'Note', isSecondary: true }
    ]}
  >
    {events.map((e) => (
      <TableRow key={e.id}>
        <TableCell kind="date" isMuted>
          {formatDateTime(e.created_at)}
        </TableCell>
        <TableCell>
          <span className="font-medium">{EVENT_LABELS[e.kind]}</span>
        </TableCell>
        <TableCell>{e.payer ?? (e.kind === 'response' ? 'Patient' : emptyValue)}</TableCell>
        <TableCell kind="date">{amountOf(e)}</TableCell>
        <TableCell isSecondary>
          <span className="flex items-center gap-3">
            {e.note}
            {e.has_document ? (
              <a
                href={documentUrl(e.id)}
                target="_blank"
                rel="noopener"
                className={fileLinkClasses}
              >
                <FileTextIcon aria-hidden="true" className="size-4" />
                View PDF
              </a>
            ) : null}
            {e.batch_id && fileUrl ? (
              <a href={fileUrl(e.batch_id)} download className={fileLinkClasses}>
                <DownloadIcon aria-hidden="true" className="size-4" />
                837P file #{e.batch_number}
              </a>
            ) : null}
          </span>
        </TableCell>
      </TableRow>
    ))}
  </Table>
);

export const PayersEditor = ({
  coverages,
  locked,
  onSave
}: {
  coverages: readonly ClaimCoverage[];
  locked: string | undefined;
  onSave: (payers: string[]) => Promise<void>;
}) => {
  const payers = coverages.map((c) => c.payer);
  const unlisted = new Set(
    coverages.filter((c) => c.payer_id === null).map((c) => c.payer.toLowerCase())
  );
  const [list, setList] = useState<string[]>(payers);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const isDirty = list.join('|') !== payers.join('|');
  const add = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed && !list.includes(trimmed)) setList([...list, trimmed]);
    setName('');
  };
  const save = async () => {
    setBusy(true);
    await onSave(list);
    setBusy(false);
  };
  return (
    <SectionPanel
      title="Payers"
      description="Billed in this order. The patient is billed after the last payer."
      actions={
        <Button
          isPending={busy}
          disabledReason={locked ?? (isDirty ? undefined : 'No changes to save.')}
          onClick={() => void save()}
        >
          <SaveIcon aria-hidden="true" className="size-4" />
          Save order
        </Button>
      }
    >
      {list.length ? (
        <ol className="divide-border border-border flex flex-col divide-y rounded-xl border">
          {list.map((p, i) => (
            <li key={p} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden="true"
                  className="bg-primary/10 text-primary grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold"
                >
                  {i + 1}
                </span>
                <span className="truncate font-medium">
                  <span className="sr-only">{i + 1}. </span>
                  {p}
                </span>
                {unlisted.has(p.toLowerCase()) ? (
                  <Link
                    to="/payers"
                    className={classNamesOf(
                      interactiveClasses,
                      'shrink-0 rounded-full hover:underline'
                    )}
                  >
                    <Badge intent="warning">Not in payer directory</Badge>
                  </Link>
                ) : null}
              </span>
              <span className="flex items-center gap-2">
                <IconButton
                  label={`Move ${p} up`}
                  icon={ArrowUpIcon}
                  disabledReason={locked ?? (i === 0 ? 'Already first.' : undefined)}
                  onClick={() => setList(moveItem(list, i, i - 1))}
                />
                <IconButton
                  label={`Move ${p} down`}
                  icon={ArrowDownIcon}
                  disabledReason={locked ?? (i === list.length - 1 ? 'Already last.' : undefined)}
                  onClick={() => setList(moveItem(list, i, i + 1))}
                />
                <Button
                  intent="danger"
                  variant="outline"
                  aria-label={`Remove ${p}`}
                  disabledReason={locked}
                  onClick={() => setList(list.filter((x) => x !== p))}
                >
                  <Trash2Icon aria-hidden="true" className="size-4" />
                  Remove
                </Button>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyText>No payers yet. The patient will be billed directly.</EmptyText>
      )}
      <form onSubmit={add} className="flex items-end gap-2" aria-label="Add payer">
        <fieldset disabled={Boolean(locked)} className="flex flex-1 items-end gap-2">
          <div className="flex-1">
            <Input
              id="payer-name"
              label="Add payer"
              placeholder="Payer name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <Button type="submit" variant="outline">
            <PlusIcon aria-hidden="true" className="size-4" />
            Add
          </Button>
        </fieldset>
      </form>
    </SectionPanel>
  );
};

export const ResponseForm = ({
  coverages,
  current,
  locked,
  onRecord
}: {
  coverages: readonly ClaimCoverage[];
  current: string | null;
  locked: string | undefined;
  onRecord: (response: ClaimResponseInput) => Promise<boolean>;
}) => {
  const empty = { coverageId: current ?? '', paid: '', adjusted: '', note: '' };
  const [draft, setDraft] = useState(empty);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (locked) return;
    const response = toResponse(draft);
    if (typeof response === 'string') {
      setError(response);
      return;
    }
    setError('');
    setBusy(true);
    const recorded = await onRecord({ ...response, requestId });
    setBusy(false);
    if (recorded) {
      setDraft(empty);
      setRequestId(crypto.randomUUID());
    }
  };
  const field = (key: keyof typeof draft) => ({
    value: draft[key],
    onChange: (e: { target: { value: string } }) => setDraft({ ...draft, [key]: e.target.value })
  });
  return (
    <SectionPanel
      title="Post Payment"
      description="A payer's remittance, or a payment from the patient. A payer payment that leaves a balance opens a reconcile task."
    >
      <form onSubmit={submit} className="flex flex-col gap-5" aria-label="Post payment">
        <fieldset
          disabled={Boolean(locked) || busy}
          className="grid gap-x-4 gap-y-5 sm:grid-cols-2"
        >
          <Select
            id="response-payer"
            label="From"
            options={[
              ...coverages.map((c) => ({ value: c.id, label: c.payer })),
              { value: '', label: 'Patient' }
            ]}
            {...field('coverageId')}
          />
          <Input id="response-note" label="Note" {...field('note')} />
          <Input
            id="response-paid"
            label="Paid (USD)"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            placeholder="0.00"
            {...field('paid')}
          />
          <Input
            id="response-adjusted"
            label="Adjusted (USD)"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            placeholder="0.00"
            {...field('adjusted')}
          />
        </fieldset>
        {error ? <Alert>{error}</Alert> : null}
        <div>
          <Button type="submit" isPending={busy} disabledReason={locked}>
            <SaveIcon aria-hidden="true" className="size-4" />
            Post payment
          </Button>
        </div>
      </form>
    </SectionPanel>
  );
};

export const describeProgress = (progress: ClaimProgress | null) => {
  if (!progress) return null;
  switch (progress.step) {
    case 'review':
      return `Needs review before it goes to ${progress.coverage.payer}. Check the claim, then approve its review task.`;
    case 'submit':
      return `Ready to submit to ${progress.coverage.payer}.`;
    case 'reconcile':
      return `${progress.coverage.payer} answered and a balance remains. A reconcile task is waiting.`;
    case 'await':
      return `Waiting on ${progress.coverage.payer}. A follow-up task opens if they have not answered 30 days after submission.`;
    case 'followUp':
      return `${progress.coverage.payer} has not answered in 30 days. A payer follow-up task is waiting.`;
    case 'statement':
      return `Sending patient statement ${progress.statement} of 3.`;
    case 'awaitPatient':
      return 'Waiting on the patient. The next statement goes out 30 days after the last one.';
    case 'collections':
      return 'Every payer and patient statement is done. A balance review task is waiting for a decision.';
    case 'closed':
      return 'Paid in full. Closing.';
  }
};

const TASK_QUEUES: Partial<Record<ClaimProgress['step'], string>> = {
  review: 'billing-review',
  reconcile: 'billing-reconcile',
  followUp: 'billing-followup',
  collections: 'billing-collections'
};

export type CycleState = {
  intent: Intent;
  text: string;
  stopped: boolean;
  restartable: boolean;
  submittable: boolean;
  tasks: string | null;
};

export const describeCycle = (
  claim: Pick<ClaimDetail, 'status' | 'cycle_status'>,
  progress: ClaimProgress | null
): CycleState | null => {
  if (isClosedStatus(claim.status)) return null;
  const base = { stopped: true, submittable: false, tasks: null };
  if (claim.status === 'draft') {
    return {
      ...base,
      stopped: false,
      restartable: false,
      intent: 'info',
      text: 'Draft. Its PCR is still being worked: patient, payer and service review happen in Tasks.',
      tasks: ''
    };
  }
  switch (claim.cycle_status) {
    case null:
      return {
        ...base,
        intent: 'warning',
        text: 'No payer cycle is running for this claim.',
        restartable: true
      };
    case 'failed':
    case 'cancelled':
      return {
        ...base,
        intent: 'danger',
        text: `The payer cycle ${claim.cycle_status === 'failed' ? 'failed' : 'was cancelled'}, so nothing more will happen on this claim until it is restarted.`,
        restartable: true
      };
    case 'faulted':
      return {
        ...base,
        intent: 'danger',
        text: 'The payer cycle hit an error. A stuck run task is waiting for a decision.',
        restartable: false,
        tasks: 'exceptions'
      };
    default: {
      const text = describeProgress(progress);
      if (!text) return null;
      const step = progress?.step;
      return {
        intent: step === 'submit' ? 'primary' : 'info',
        text,
        stopped: false,
        restartable: false,
        submittable: step === 'submit',
        tasks: (step && TASK_QUEUES[step]) ?? null
      };
    }
  }
};

export type Submission = {
  issues: readonly string[] | null;
  made: Batch | null;
  fileUrl: (batchId: string) => string;
  encounterUrl: (reportId: string) => string;
  onCreateFile: () => Promise<void>;
  onMarkSubmitted: () => Promise<void>;
};

const SubmitActions = ({ payer, submission }: { payer: string; submission: Submission }) => {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const blocked =
    submission.issues === null
      ? 'Checking the claim…'
      : submission.issues.length
        ? 'Fix the problems listed first.'
        : undefined;
  return (
    <>
      <Button
        isPending={busy}
        disabledReason={blocked}
        onClick={async () => {
          setBusy(true);
          await submission.onCreateFile();
          setBusy(false);
        }}
      >
        <FileCogIcon aria-hidden="true" className="size-4" />
        Create 837P file
      </Button>
      <Button variant="outline" onClick={() => setConfirming(true)}>
        <SendIcon aria-hidden="true" className="size-4" />
        Mark submitted
      </Button>
      <ConfirmDialog
        open={confirming}
        title="Mark as Submitted?"
        confirmLabel="Mark submitted"
        confirmIcon={SendIcon}
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void submission.onMarkSubmitted();
        }}
      >
        Use this when the claim to {payer} went out another way, such as the clearinghouse portal or
        paper. The payer clock starts now.
      </ConfirmDialog>
    </>
  );
};

const CycleAlert = ({
  claim,
  progress,
  submission,
  onRestart
}: {
  claim: ClaimDetail;
  progress: ClaimProgress | null;
  submission: Submission | undefined;
  onRestart: () => Promise<void>;
}) => {
  const [restarting, setRestarting] = useState(false);
  const status = describeCycle(claim, progress);
  const made = submission?.made;
  const notice = made ? (
    <Alert
      intent="success"
      action={<BatchDownload batch={made} href={submission.fileUrl(made.id)} />}
    >
      837P file #{made.control_number} is ready. Upload it to your clearinghouse.
    </Alert>
  ) : null;
  if (!status) return notice;
  const runLink = status.stopped && claim.cycle_run_id ? claim.cycle_run_id : null;
  const payer = progress && 'coverage' in progress ? progress.coverage.payer : '';
  const issues = status.submittable ? (submission?.issues ?? []) : [];
  const actions = (
    <>
      {status.submittable && submission ? (
        <SubmitActions payer={payer} submission={submission} />
      ) : null}
      {issues.length ? (
        <ButtonLink to={`/claims/${claim.id}?tab=data`} variant="outline">
          <PencilIcon aria-hidden="true" className="size-4" />
          Fix claim data
        </ButtonLink>
      ) : null}
      {status.tasks !== null ? (
        <ButtonLink
          to={status.tasks ? `/tasks?type=${encodeURIComponent(status.tasks)}` : '/tasks'}
          variant="outline"
        >
          <ListTodoIcon aria-hidden="true" className="size-4" />
          Open tasks
        </ButtonLink>
      ) : null}
      {runLink ? (
        <ButtonLink to={`/runs/${runLink}`} variant="outline">
          <ExternalLinkIcon aria-hidden="true" className="size-4" />
          Open the cycle run
        </ButtonLink>
      ) : null}
      {status.restartable ? (
        <Button
          variant="outline"
          isPending={restarting}
          onClick={async () => {
            setRestarting(true);
            await onRestart();
            setRestarting(false);
          }}
        >
          <RotateCcwIcon aria-hidden="true" className="size-4" />
          Restart payer cycle
        </Button>
      ) : null}
    </>
  );
  return (
    <>
      {notice}
      <Alert intent={status.intent} action={actions}>
        <span className="flex flex-col gap-1">
          {status.text}
          {issues.length ? (
            <ul className="list-disc pl-4 text-sm">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
        </span>
      </Alert>
    </>
  );
};

export type ClaimTab = 'overview' | 'data' | 'history';

export const CLAIM_TABS: readonly { value: ClaimTab; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'data', label: 'Claim data' },
  { value: 'history', label: 'History' }
];

export const ClaimView = ({
  claim,
  events,
  progress,
  onSavePayers,
  onRecord,
  onRestart,
  onSaveData,
  documentUrl,
  submission,
  tab = 'overview',
  error = ''
}: {
  claim: ClaimDetail;
  events: readonly ClaimEvent[];
  progress: ClaimProgress | null;
  onSavePayers: (payers: string[]) => Promise<void>;
  onRecord: (response: ClaimResponseInput) => Promise<boolean>;
  onRestart: () => Promise<void>;
  onSaveData: (data: BillingDataInput) => Promise<boolean>;
  documentUrl: (eventId: string) => string;
  submission?: Submission;
  tab?: ClaimTab;
  error?: string;
}) => {
  const locked = lockedReason(claim.status);
  const path = `/claims/${claim.id}`;
  const current = progress && 'coverage' in progress ? progress.coverage.id : null;
  const coverageKey = claim.coverages.map((c) => `${c.id}:${c.payer}`).join('|');
  return (
    <Page
      title={`Claim ${claimNumber(claim.number)}`}
      backTo="/claims"
      backLabel="Back to Claims"
      description={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <ClaimStatusBadge status={claim.status} />
          <span className="text-surface-fg font-medium">
            {claim.last_name}, {claim.first_name}
          </span>
          <span>Patient {claimNumber(claim.patient_number)}</span>
          <span>{claim.pcr_number ? `Encounter ${claim.pcr_number}` : 'No encounter number'}</span>
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
      <CycleAlert claim={claim} progress={progress} submission={submission} onRestart={onRestart} />
      <Tabs
        label="Claim sections"
        tabs={CLAIM_TABS.map((t) => ({
          label: t.label,
          href: t.value === 'overview' ? path : `${path}?tab=${t.value}`,
          isSelected: t.value === tab,
          count: t.value === 'history' ? events.length : undefined
        }))}
      />
      {tab === 'overview' ? (
        <>
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
              <Detail label="Service date">{formatDate(claim.service_date)}</Detail>
              <Detail label="Born">{formatDate(claim.birth_date)}</Detail>
              <Detail label="Transport">
                {claim.level ?? emptyValue}
                {claim.emergency ? ' emergency' : ''}
                {claim.loaded_miles ? ` · ${claim.loaded_miles} loaded miles` : ''}
              </Detail>
            </DetailList>
          </SectionPanel>
          <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
            <div className="flex min-w-0 flex-col gap-6">
              <SectionPanel title="Charges" description="Priced from the fee schedule.">
                <LinesTable lines={claim.lines} />
              </SectionPanel>
              <PayersEditor
                key={coverageKey}
                coverages={claim.coverages}
                locked={locked}
                onSave={onSavePayers}
              />
              {submission ? (
                <ClaimFiles
                  claim={claim}
                  events={events}
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
          {events.length ? (
            <ClaimHistory
              claimId={claim.id}
              events={events}
              documentUrl={documentUrl}
              fileUrl={submission?.fileUrl}
            />
          ) : (
            <EmptyText>Nothing has happened on this claim yet.</EmptyText>
          )}
        </SectionPanel>
      )}
    </Page>
  );
};

export const ClaimPage = ({ client, live, claimId, tab = 'overview' }: ClaimPageProps) => {
  const detail = useResource(`claim:${claimId}`, () => client.find(claimId), 15_000);
  const cycleRun = detail.data?.claim.cycle_run_id;
  useLive(
    live,
    (e) =>
      (e.kind === 'claim' && (e.id === claimId || e.id === null)) ||
      (e.kind === 'run' && e.id === cycleRun),
    detail.reload
  );
  const submittable = detail.data?.progress?.step === 'submit';
  const pending = useResource(`claim:${claimId}:pending:${submittable}`, () =>
    submittable ? client.pending(claimId) : Promise.resolve(null)
  );
  const [error, setError] = useState('');
  const [made, setMade] = useState<Batch | null>(null);
  const notify = useToast();
  const patient = detail.data
    ? `Claim ${claimNumber(detail.data.claim.number)} · ${detail.data.claim.last_name}, ${detail.data.claim.first_name}`
    : '';
  const act = async (action: () => Promise<unknown>, done: string) => {
    setError('');
    try {
      await action();
      detail.reload();
      pending.reload();
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
      error={error}
      claim={detail.data.claim}
      events={detail.data.events}
      progress={detail.data.progress}
      onSavePayers={async (payers) => {
        await act(() => client.setPayers(claimId, payers), 'Payer order saved');
      }}
      onRecord={(response) => act(() => client.recordResponse(claimId, response), 'Payment posted')}
      onSaveData={(data) =>
        act(() => client.saveBillingData(claimId, data), 'Billing details saved')
      }
      documentUrl={(eventId) => client.documentUrl(claimId, eventId)}
      onRestart={async () => {
        await act(() => client.restartCycle(claimId), 'Payer cycle restarted');
      }}
      submission={{
        issues: pending.data?.claims[0]?.issues ?? (pending.data ? [] : null),
        made,
        fileUrl: client.fileUrl,
        encounterUrl: client.encounterUrl,
        onCreateFile: async () => {
          setMade(null);
          await act(async () => setMade(await client.createBatch(claimId)), '837P file created');
        },
        onMarkSubmitted: async () => {
          await act(() => client.markSubmitted(claimId), 'Marked submitted');
        }
      }}
    />
  );
};
