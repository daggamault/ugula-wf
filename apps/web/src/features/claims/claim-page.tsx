import {
  ADJUSTMENT_GROUPS,
  ADJUSTMENT_REASON_PATTERN,
  type AdjustmentGroup,
  type ClaimIssue,
  INSURED_RELATIONSHIPS,
  type InsuredRelationship,
  isClosedStatus,
  PAYER_FILE_LABELS,
  RELATIONSHIP_LABELS,
  TRIP_TYPE_LABELS
} from '@ugula/billing';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileInputIcon,
  FileTextIcon,
  ListTodoIcon,
  PlusIcon,
  RotateCcwIcon,
  SaveIcon,
  UserIcon
} from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { ChargeLines } from '../../shared/claims/charge-lines.tsx';
import { ClaimIssues } from '../../shared/claims/claim-issues.tsx';
import { classNamesOf } from '../../shared/class-names.ts';
import { downloadText } from '../../shared/download.ts';
import {
  formatAgo,
  formatCents,
  formatDate,
  formatDateTime,
  formatMiles,
  parseDollars,
  titleCaseLabel
} from '../../shared/format.ts';
import { type Live, useLive } from '../../shared/live.ts';
import { OUTCOME_STYLES } from '../../shared/payer-file-outcomes.ts';
import { Link } from '../../shared/router.tsx';
import { queueInfo } from '../../shared/task-queues.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { Badge } from '../../shared/ui/badge.tsx';
import { Button, ButtonLink } from '../../shared/ui/button.tsx';
import { Detail, DetailList } from '../../shared/ui/detail-list.tsx';
import { EmptyText, emptyValue } from '../../shared/ui/empty-state.tsx';
import { FieldGrid, FieldGroup, FormActions } from '../../shared/ui/field.tsx';
import { IconButton, RemoveButton } from '../../shared/ui/icon-button.tsx';
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
import {
  backLabelOf,
  type Page as ListPage,
  useTableState,
  withBack
} from '../../shared/url-state.ts';
import { type Resource, useResource } from '../../shared/use-resource.ts';
import { ClaimDataForm } from './claim-data-form.tsx';
import { DocumentationPanel, EligibilityPanel } from './claim-documentation.tsx';
import { ClaimStatusBadge } from './claim-status-badge.tsx';
import { assigneeOf, claimNumber } from './claims-page.tsx';
import type {
  BillingDataInput,
  ClaimCoverage,
  ClaimDetail,
  ClaimEvent,
  ClaimLine,
  ClaimPayerFile,
  ClaimProgress,
  ClaimResponseInput,
  ClaimsClient,
  ClaimTask,
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
  edited: 'Claim data edited',
  refunded: 'Refunded',
  closed: 'Closed',
  accepted: 'Accepted by the payer',
  rejected: 'Rejected',
  eligibility: 'Eligibility checked',
  claim_status: 'Claim status from the payer',
  denied: 'Denied',
  appeal_packet: 'Appeal packet',
  appealed: 'Appeal sent',
  appeal_decided: 'Appeal decided',
  reopening_requested: 'Reopening requested',
  records_requested: 'Records requested',
  records_sent: 'Records sent',
  closing_approved: 'Closing approved',
  balance_protected: 'Balance-billing protection',
  facility_invoiced: 'Facility invoice'
};

export const lockedReason = (status: ClaimDetail['status']) =>
  isClosedStatus(status)
    ? 'This claim is closed.'
    : status === 'draft'
      ? 'This claim is still a draft. Finish its PCR tasks first.'
      : undefined;

const fileLinkClasses = classNamesOf(
  textLinkClasses,
  'inline-flex items-center gap-2 whitespace-nowrap'
);

export const ClaimFiles = ({
  claim,
  files,
  payerFiles,
  back,
  documentUrl,
  fileUrl,
  encounterUrl
}: {
  claim: Pick<ClaimDetail, 'import_report_id' | 'pcr_number' | 'import_id' | 'import_file_name'>;
  files: readonly ClaimEvent[];
  payerFiles: readonly ClaimPayerFile[];
  back: string;
  documentUrl: (eventId: string) => string;
  fileUrl: (batchId: string) => string;
  encounterUrl: (reportId: string) => string;
}) => {
  const batches = files.filter((e) => e.batch_id);
  const documents = files.filter((e) => e.has_document);
  return (
    <SectionPanel
      title="Files"
      description="The encounter and import this claim came from, every 837P file and document sent for it, and every clearinghouse file that answered it."
    >
      <ul className="flex flex-col gap-2 text-sm">
        <li className="flex flex-wrap items-center gap-2">
          {claim.import_report_id ? (
            <>
              <a href={encounterUrl(claim.import_report_id)} download className={fileLinkClasses}>
                <DownloadIcon aria-hidden="true" className="size-4" />
                Encounter {claim.pcr_number ?? ''} (NEMSIS XML)
              </a>
              {claim.import_id ? (
                <span className="text-surface-fg-muted">
                  from{' '}
                  <Link
                    to={withBack(`/imports/${claim.import_id}`, back)}
                    className={textLinkClasses}
                  >
                    {claim.import_file_name}
                  </Link>
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-surface-fg-muted">No source encounter file.</span>
          )}
        </li>
        {batches.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-2">
            <a href={fileUrl(e.batch_id ?? '')} download className={fileLinkClasses}>
              <DownloadIcon aria-hidden="true" className="size-4" />
              837P File #{e.batch_number}
            </a>
            <span className="text-surface-fg-muted">
              {e.payer} · {formatDateTime(e.created_at)}
            </span>
            {e.batch_sent_at ? (
              <Badge intent="success">Sent {formatDateTime(e.batch_sent_at)}</Badge>
            ) : (
              <Badge intent="warning">Not sent; upload it to the clearinghouse</Badge>
            )}
          </li>
        ))}
        {payerFiles.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center gap-2">
            <Link to={withBack(`/payer-files/${f.id}`, back)} className={fileLinkClasses}>
              <FileInputIcon aria-hidden="true" className="size-4" />
              {f.file_name}
            </Link>
            <span className="text-surface-fg-muted">
              {PAYER_FILE_LABELS[f.kind]} · {formatDateTime(f.created_at)}
            </span>
            {f.items.map((i, n) => (
              <span key={`${f.id}-${n}`} className="flex items-center gap-2">
                <Badge intent={OUTCOME_STYLES[i.outcome].intent}>
                  {OUTCOME_STYLES[i.outcome].label}
                </Badge>
                {i.message ? <span className="text-surface-fg-muted">{i.message}</span> : null}
              </span>
            ))}
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

export const moveItem = <T,>(items: readonly T[], from: number, to: number) => {
  if (to < 0 || to >= items.length) return [...items];
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
};

type ResponseKind = ClaimResponseInput['kind'];

type AdjustmentDraft = { id: string; group: AdjustmentGroup; reason: string; amount: string };

export type ResponseDraft = {
  kind: ResponseKind;
  coverageId: string;
  paid: string;
  adjusted: string;
  paidOn: string;
  checkNumber: string;
  payerClaimNumber: string;
  adjustments: AdjustmentDraft[];
  note: string;
};

const REASON = new RegExp(ADJUSTMENT_REASON_PATTERN);

const signedCents = (text: string) => {
  const amount = Number(text);
  return text.trim() !== '' && Number.isFinite(amount) && amount !== 0
    ? Math.round(amount * 100)
    : null;
};

const adjustmentOf = (a: AdjustmentDraft) => {
  const reason = a.reason.trim().toUpperCase();
  const cents = signedCents(a.amount);
  return REASON.test(reason) && cents !== null ? { group: a.group, reason, cents } : null;
};

const orNull = (text: string) => text.trim() || null;

export const toResponse = (
  draft: ResponseDraft
): Omit<ClaimResponseInput, 'requestId'> | string => {
  const isRefund = draft.kind === 'refunded';
  const paidCents = parseDollars(draft.paid || '0');
  const adjustedCents = isRefund ? 0 : parseDollars(draft.adjusted || '0');
  if (paidCents === null || adjustedCents === null) return 'Enter amounts of zero or more';
  if (isRefund && paidCents === 0) return 'A refund needs the amount paid back';
  if (paidCents + adjustedCents === 0 && draft.coverageId === '') {
    return 'A patient payment needs an amount';
  }
  const adjustments = isRefund ? [] : draft.adjustments.map(adjustmentOf);
  if (adjustments.some((a) => a === null)) {
    return 'Each reason code needs a code like 45 and an amount other than zero';
  }
  const coverageId = draft.coverageId || null;
  return {
    kind: draft.kind,
    coverageId,
    paidCents,
    adjustedCents,
    paidOn: orNull(draft.paidOn),
    checkNumber: orNull(draft.checkNumber),
    payerClaimNumber: coverageId && !isRefund ? orNull(draft.payerClaimNumber) : null,
    adjustments: adjustments.filter((a) => a !== null),
    note: draft.note.trim()
  };
};

export const paymentDetailsOf = (
  e: Pick<ClaimEvent, 'paid_on' | 'check_number' | 'payer_claim_number'>
) =>
  [
    e.paid_on ? `Paid ${formatDate(e.paid_on)}` : '',
    e.check_number ? `Check or EFT ${e.check_number}` : '',
    e.payer_claim_number ? `Payer claim ${e.payer_claim_number}` : ''
  ]
    .filter(Boolean)
    .join(' · ');

export const amountOf = (e: Pick<ClaimEvent, 'kind' | 'paid_cents' | 'adjusted_cents'>) =>
  e.kind === 'refunded'
    ? `${formatCents(Math.abs(e.paid_cents))} refunded`
    : [
        e.paid_cents ? `${formatCents(e.paid_cents)} paid` : '',
        e.adjusted_cents ? `${formatCents(e.adjusted_cents)} adjusted` : ''
      ]
        .filter(Boolean)
        .join(' · ');

const pricedLinesOf = (lines: readonly ClaimLine[]) =>
  lines.map((l) => ({
    code: l.code,
    units: Number(l.units),
    unitCents: l.unit_cents,
    totalCents: l.total_cents
  }));

const HISTORY_TABLE = {
  prefix: 'history',
  sorts: { when: 'desc', event: 'asc', payer: 'asc', amount: 'desc' },
  sort: 'when'
} as const;

const useHistoryTable = (claimId: string) => useTableState(`/claims/${claimId}`, HISTORY_TABLE);

const ClaimHistory = ({
  claimId,
  history,
  documentUrl,
  fileUrl
}: {
  claimId: string;
  history: Resource<ListPage<ClaimEvent>>;
  documentUrl: (eventId: string) => string;
  fileUrl?: ((batchId: string) => string) | undefined;
}) => {
  const table = useHistoryTable(claimId);
  return history.error ? (
    <Alert>{history.error.message}</Alert>
  ) : history.data?.items.length ? (
    <>
      <EventsTable
        events={history.data.items}
        sorting={table}
        documentUrl={documentUrl}
        fileUrl={fileUrl}
      />
      <Pagination label="Claim history" total={history.data.total} state={table} />
    </>
  ) : history.loading ? (
    <PageLoading />
  ) : (
    <EmptyText>Nothing has happened on this claim yet.</EmptyText>
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
        <TableCell kind="numeric">{amountOf(e)}</TableCell>
        <TableCell isSecondary>
          <span className="flex flex-col gap-0.5">
            {paymentDetailsOf(e) ? (
              <span className="text-surface-fg-muted text-xs">{paymentDetailsOf(e)}</span>
            ) : null}
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
                  837P File #{e.batch_number}
                </a>
              ) : null}
            </span>
          </span>
        </TableCell>
      </TableRow>
    ))}
  </Table>
);

type PayerEntry = PayerInput & { id: string };

const SELF: InsuredRelationship = '18';

const RELATIONSHIP_OPTIONS = INSURED_RELATIONSHIPS.map((r) => ({
  value: r,
  label: titleCaseLabel(RELATIONSHIP_LABELS[r])
}));

const isRelationshipCode = (x: string): x is InsuredRelationship =>
  INSURED_RELATIONSHIPS.some((r) => r === x);

export const entryOf = (c: ClaimCoverage): PayerEntry => ({
  id: c.id,
  name: c.payer,
  relationship: c.relationship,
  insuredFirstName: c.insured_first_name,
  insuredLastName: c.insured_last_name
});

export const toPayerInput = ({ id, ...e }: PayerEntry): PayerInput =>
  e.relationship === SELF
    ? { ...e, insuredFirstName: null, insuredLastName: null }
    : {
        ...e,
        insuredFirstName: e.insuredFirstName?.trim() || null,
        insuredLastName: e.insuredLastName?.trim() || null
      };

export const payersErrorOf = (entries: readonly PayerEntry[]) => {
  const missing = entries.find((e) => {
    const input = toPayerInput(e);
    return input.relationship !== SELF && (!input.insuredFirstName || !input.insuredLastName);
  });
  return missing ? `Enter the insured's first and last name for ${missing.name}.` : undefined;
};

export const removeEntry = (entries: readonly PayerEntry[], id: string) =>
  entries.filter((e) => e.id !== id);

export const addEntry = (entries: readonly PayerEntry[], name: string, id: string) => {
  const trimmed = name.trim();
  const key = trimmed.toLowerCase();
  return !trimmed || entries.some((e) => e.name.toLowerCase() === key)
    ? [...entries]
    : [
        ...entries,
        {
          id,
          name: trimmed,
          relationship: SELF,
          insuredFirstName: null,
          insuredLastName: null
        }
      ];
};

const PayersEditor = ({
  coverages,
  locked,
  onSave
}: {
  coverages: readonly ClaimCoverage[];
  locked: string | undefined;
  onSave: (payers: PayerInput[]) => Promise<void>;
}) => {
  const saved = JSON.stringify(coverages.map((c) => toPayerInput(entryOf(c))));
  const unlisted = new Set(
    coverages.filter((c) => c.payer_id === null).map((c) => c.payer.toLowerCase())
  );
  const [list, setList] = useState<PayerEntry[]>(() => coverages.map(entryOf));
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [isChecked, setChecked] = useState(false);
  const inputs = list.map(toPayerInput);
  const isDirty = JSON.stringify(inputs) !== saved;
  const problem = isChecked ? payersErrorOf(list) : undefined;
  const patch = (id: string, next: Partial<PayerEntry>) =>
    setList(list.map((e) => (e.id === id ? { ...e, ...next } : e)));
  const add = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setList(addEntry(list, name, crypto.randomUUID()));
    setName('');
  };
  const save = async () => {
    setChecked(true);
    if (payersErrorOf(list)) return;
    setBusy(true);
    await onSave(inputs);
    setBusy(false);
  };
  return (
    <SectionPanel
      title="Payers"
      description="Billed in this order, with the patient billed after the last payer."
      actions={
        <Button
          isPending={busy}
          disabledReason={locked ?? (isDirty ? undefined : 'No changes to save.')}
          onClick={() => void save()}
        >
          <SaveIcon aria-hidden="true" className="size-4" />
          Save Payers
        </Button>
      }
    >
      {list.length ? (
        <ol className="divide-border border-border flex flex-col divide-y rounded-xl border">
          {list.map(({ id, name: p, relationship, insuredFirstName, insuredLastName }, i) => (
            <li key={id} className="flex flex-col gap-4 px-4 py-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="bg-primary/10 text-primary min-w-5 shrink-0 rounded-full px-1.5 text-center text-xs/5 font-semibold tabular-nums"
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
                      <Badge intent="warning">Not in Payer Directory</Badge>
                    </Link>
                  ) : null}
                </span>
                <span className="flex items-center gap-1">
                  <IconButton
                    label={`Move ${p} up`}
                    tooltip="Move Up"
                    icon={ArrowUpIcon}
                    disabledReason={locked ?? (i === 0 ? 'Already first.' : undefined)}
                    onClick={() => setList(moveItem(list, i, i - 1))}
                  />
                  <IconButton
                    label={`Move ${p} down`}
                    tooltip="Move Down"
                    icon={ArrowDownIcon}
                    disabledReason={locked ?? (i === list.length - 1 ? 'Already last.' : undefined)}
                    onClick={() => setList(moveItem(list, i, i + 1))}
                  />
                  <RemoveButton
                    label={`Remove ${p}`}
                    disabledReason={locked}
                    onClick={() => setList(removeEntry(list, id))}
                  />
                </span>
              </div>
              <fieldset disabled={Boolean(locked)}>
                <FieldGrid>
                  <Select
                    id={`payer-${id}-relationship`}
                    label="Patient Is the Insured's"
                    span={relationship === SELF ? 4 : 2}
                    options={RELATIONSHIP_OPTIONS}
                    value={relationship}
                    onChange={(e) => {
                      if (isRelationshipCode(e.target.value)) {
                        patch(id, { relationship: e.target.value });
                      }
                    }}
                  />
                  {relationship === SELF ? null : (
                    <>
                      <Input
                        id={`payer-${id}-insured-first`}
                        label="Insured First Name"
                        required
                        error={problem && !insuredFirstName?.trim() ? 'Required' : undefined}
                        value={insuredFirstName ?? ''}
                        onChange={(e) => patch(id, { insuredFirstName: e.target.value })}
                      />
                      <Input
                        id={`payer-${id}-insured-last`}
                        label="Insured Last Name"
                        required
                        error={problem && !insuredLastName?.trim() ? 'Required' : undefined}
                        value={insuredLastName ?? ''}
                        onChange={(e) => patch(id, { insuredLastName: e.target.value })}
                      />
                    </>
                  )}
                </FieldGrid>
              </fieldset>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyText>No payers yet. The patient will be billed directly.</EmptyText>
      )}
      {problem ? <Alert>{problem}</Alert> : null}
      <form onSubmit={add} className="flex items-end gap-2" aria-label="Add payer">
        <fieldset disabled={Boolean(locked)} className="flex flex-1 items-end gap-2">
          <div className="flex-1">
            <Input
              id="payer-name"
              label="Add Payer"
              placeholder="Payer Name"
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

const GROUP_OPTIONS = Object.entries(ADJUSTMENT_GROUPS).map(([value, label]) => ({
  value,
  label: `${value} · ${label}`
}));

const KIND_OPTIONS = [
  { value: 'response', label: 'Payment' },
  { value: 'refunded', label: 'Refund' }
];

const isGroup = (x: string): x is AdjustmentGroup => Object.hasOwn(ADJUSTMENT_GROUPS, x);

const moneyProps = {
  type: 'number',
  inputMode: 'decimal',
  step: '0.01',
  placeholder: '0.00'
} as const;

const ReasonCodes = ({
  rows,
  onChange
}: {
  rows: readonly AdjustmentDraft[];
  onChange: (rows: AdjustmentDraft[]) => void;
}) => {
  const patch = (id: string, next: Partial<AdjustmentDraft>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...next } : r)));
  return (
    <FieldGroup title="Reason Codes">
      {rows.length ? (
        <ol className="flex flex-col gap-5">
          {rows.map((r, i) => (
            <li key={r.id} className="flex flex-wrap items-end gap-x-4 gap-y-5">
              <div className="min-w-48 flex-1">
                <Select
                  id={`adjustment-${r.id}-group`}
                  label="Group"
                  options={GROUP_OPTIONS}
                  value={r.group}
                  onChange={(e) => {
                    if (isGroup(e.target.value)) patch(r.id, { group: e.target.value });
                  }}
                />
              </div>
              <div className="w-28">
                <Input
                  id={`adjustment-${r.id}-reason`}
                  label="Code"
                  isMonospace
                  placeholder="45"
                  value={r.reason}
                  onChange={(e) => patch(r.id, { reason: e.target.value })}
                />
              </div>
              <div className="w-32">
                <Input
                  id={`adjustment-${r.id}-amount`}
                  label="Amount (USD)"
                  {...moneyProps}
                  value={r.amount}
                  onChange={(e) => patch(r.id, { amount: e.target.value })}
                />
              </div>
              <span className="flex h-10 items-center pointer-coarse:h-11">
                <RemoveButton
                  label={`Remove reason code ${i + 1}`}
                  onClick={() => onChange(rows.filter((x) => x.id !== r.id))}
                />
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      <div>
        <Button
          variant="outline"
          onClick={() =>
            onChange([...rows, { id: crypto.randomUUID(), group: 'CO', reason: '', amount: '' }])
          }
        >
          <PlusIcon aria-hidden="true" className="size-4" />
          Add Reason Code
        </Button>
      </div>
    </FieldGroup>
  );
};

const emptyResponse = (coverageId: string): ResponseDraft => ({
  kind: 'response',
  coverageId,
  paid: '',
  adjusted: '',
  paidOn: '',
  checkNumber: '',
  payerClaimNumber: '',
  adjustments: [],
  note: ''
});

const ResponseForm = ({
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
  const [draft, setDraft] = useState(() => emptyResponse(current ?? ''));
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isRefund = draft.kind === 'refunded';
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
      setDraft(emptyResponse(current ?? ''));
      setRequestId(crypto.randomUUID());
    }
  };
  const field = (key: Exclude<keyof ResponseDraft, 'adjustments'>) => ({
    value: draft[key],
    onChange: (e: { target: { value: string } }) => setDraft({ ...draft, [key]: e.target.value })
  });
  return (
    <SectionPanel
      title="Post Payment"
      description="A payer's remittance or a patient payment, or a refund of either. A payer payment that leaves a balance opens a reconcile task."
    >
      <form onSubmit={submit} className="flex flex-col gap-5" aria-label="Post payment">
        <fieldset disabled={Boolean(locked) || busy} className="flex flex-col gap-8">
          <FieldGrid>
            <Select
              id="response-payer"
              label="From"
              span={2}
              options={[
                ...coverages.map((c) => ({ value: c.id, label: c.payer })),
                { value: '', label: 'Patient' }
              ]}
              {...field('coverageId')}
            />
            <Select id="response-kind" label="Type" options={KIND_OPTIONS} {...field('kind')} />
            <Input id="response-paid-on" label="Paid On" type="date" {...field('paidOn')} />
            <Input
              id="response-paid"
              label={isRefund ? 'Refunded (USD)' : 'Paid (USD)'}
              min="0"
              {...moneyProps}
              {...field('paid')}
            />
            {isRefund ? null : (
              <Input
                id="response-adjusted"
                label="Adjusted (USD)"
                min="0"
                {...moneyProps}
                {...field('adjusted')}
              />
            )}
            <Input id="response-check" label="Check or EFT Number" {...field('checkNumber')} />
            {isRefund || draft.coverageId === '' ? null : (
              <Input
                id="response-payer-claim"
                label="Payer Claim Number"
                {...field('payerClaimNumber')}
              />
            )}
            <Input id="response-note" label="Note" span={4} {...field('note')} />
          </FieldGrid>
          {isRefund ? null : (
            <ReasonCodes
              rows={draft.adjustments}
              onChange={(adjustments) => setDraft({ ...draft, adjustments })}
            />
          )}
        </fieldset>
        {error ? <Alert>{error}</Alert> : null}
        <FormActions>
          <Button type="submit" isPending={busy} disabledReason={locked}>
            <SaveIcon aria-hidden="true" className="size-4" />
            {isRefund ? 'Record Refund' : 'Post Payment'}
          </Button>
        </FormActions>
      </form>
    </SectionPanel>
  );
};

export const describeProgress = (progress: ClaimProgress): string => {
  switch (progress.step) {
    case 'review':
      return `Needs review before it goes to ${progress.coverage.payer}. Check the claim, then approve its review task. Its 837P file is created as soon as it is approved.`;
    case 'submit':
      return `Approved. Creating its 837P file for ${progress.coverage.payer}; a task opens if it cannot be created.`;
    case 'reconcile':
      return `${progress.coverage.payer} answered and a balance remains. A reconcile task is waiting.`;
    case 'workDenial':
      return `${progress.coverage.payer} denied the claim. A denial decision, correction or appeal is being worked.`;
    case 'await':
      return `Waiting on ${progress.coverage.payer}. A follow-up task opens if they have not answered 30 days after submission.`;
    case 'followUp':
      return `${progress.coverage.payer} has not answered in 30 days. A payer follow-up task is waiting.`;
    case 'reviewPatient':
      return 'Every payer is done. A review task is waiting before the patient is billed.';
    case 'confirmPayers':
      return 'No payer is on this claim. A task is waiting to add one or confirm the patient pays.';
    case 'overpaid':
      return `${formatCents(-progress.balanceCents)} more has been paid than the claim charges. A refund task is waiting.`;
    case 'statement':
      return `Sending patient statement ${progress.statement} of 3.`;
    case 'awaitPatient':
      return 'Waiting on the patient. The next statement goes out 30 days after the last one.';
    case 'facility':
      return 'A facility is responsible for this trip. It is billed on the monthly facility invoice.';
    case 'collections':
      return 'Every payer and patient statement is done. A balance review task is waiting for a decision.';
    case 'writeOff':
      return 'The balance left is within what the agency writes off. Closing as written off.';
    case 'closed':
      return 'Paid in full. Closing.';
  }
};

type CycleState = {
  intent: Intent;
  text: string;
  stopped: boolean;
  restartable: boolean;
};

export const describeCycle = (
  claim: Pick<ClaimDetail, 'status' | 'cycle_status'>,
  progress: ClaimProgress | null
): CycleState | null => {
  if (isClosedStatus(claim.status)) return null;
  const base = { stopped: true };
  if (claim.status === 'draft') {
    return {
      ...base,
      stopped: false,
      restartable: false,
      intent: 'info',
      text: 'Draft. Its PCR is still being worked into a claim.'
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
        restartable: false
      };
    default: {
      if (!progress) return null;
      return {
        intent: progress.step === 'overpaid' ? 'warning' : 'info',
        text: describeProgress(progress),
        stopped: false,
        restartable: false
      };
    }
  }
};

type ClaimLinks = {
  fileUrl: (batchId: string) => string;
  encounterUrl: (reportId: string) => string;
};

const CycleAlert = ({
  claim,
  progress,
  onRestart
}: {
  claim: ClaimDetail;
  progress: ClaimProgress | null;
  onRestart: () => Promise<void>;
}) => {
  const [restarting, setRestarting] = useState(false);
  const status = describeCycle(claim, progress);
  if (!status) return null;
  const runLink = status.stopped && claim.cycle_run_id ? claim.cycle_run_id : null;
  const actions = (
    <>
      {runLink ? (
        <ButtonLink to={`/runs/${runLink}`} variant="outline">
          <ExternalLinkIcon aria-hidden="true" className="size-4" />
          Open Cycle Run
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
          Restart Payer Cycle
        </Button>
      ) : null}
    </>
  );
  return (
    <Alert intent={status.intent} action={actions}>
      {status.text}
    </Alert>
  );
};

const OpenTasks = ({
  tasks,
  back,
  me
}: {
  tasks: readonly ClaimTask[];
  back: string;
  me: string;
}) =>
  tasks.map((t) => (
    <Alert
      key={t.id}
      intent={t.kind === 'fault' ? 'danger' : 'warning'}
      action={
        <ButtonLink to={withBack(`/tasks/${t.id}`, back)}>
          <ListTodoIcon aria-hidden="true" className="size-4" />
          Work Task
        </ButtonLink>
      }
    >
      <span className="flex flex-col gap-0.5">
        <span className="font-semibold">{t.title}</span>
        <span className="text-xs">
          {queueInfo(t.queue).label} · {assigneeOf(t.assignee_email, me)} · opened{' '}
          {formatAgo(t.created_at)}
        </span>
      </span>
    </Alert>
  ));

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
      title={`Claim ${claimNumber(claim.number)}`}
      backTo={back}
      backLabel={backLabelOf(back)}
      description={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <ClaimStatusBadge status={claim.status} />
          <span className="text-surface-fg font-medium">{patientName(claim)}</span>
          {claim.patient_number !== null ? (
            <span>Patient {claimNumber(claim.patient_number)}</span>
          ) : null}
          <span>{claim.pcr_number ? `Encounter ${claim.pcr_number}` : 'No encounter number'}</span>
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
    ? `Claim ${claimNumber(detail.data.claim.number)} · ${patientName(detail.data.claim)}`
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
    />
  );
};
