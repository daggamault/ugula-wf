import {
  ArrowDownIcon,
  ArrowUpIcon,
  ExternalLinkIcon,
  FileTextIcon,
  PlusIcon,
  RotateCcwIcon,
  SaveIcon,
  Trash2Icon
} from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { formatCents, formatDateTime, parseDollars } from '../../shared/format.ts';
import { type Live, useLive } from '../../shared/live.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { Button, ButtonLink } from '../../shared/ui/button.tsx';
import { Detail, DetailList } from '../../shared/ui/detail-list.tsx';
import { EmptyText, emptyValue } from '../../shared/ui/empty-state.tsx';
import { IconButton } from '../../shared/ui/icon-button.tsx';
import { Input } from '../../shared/ui/input.tsx';
import type { Intent } from '../../shared/ui/intent.ts';
import { Page, PageFailure, PageLoading } from '../../shared/ui/page.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { Select } from '../../shared/ui/select.tsx';
import { Table, TableCell, TableRow } from '../../shared/ui/table.tsx';
import { textLinkClasses } from '../../shared/ui/text-link.tsx';
import { useResource } from '../../shared/use-resource.ts';
import { ClaimDataForm } from './claim-data-form.tsx';
import { ClaimStatusBadge } from './claim-status-badge.tsx';
import type {
  BillingDataInput,
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
};

const EVENT_LABELS: Record<ClaimEvent['kind'], string> = {
  submitted: 'Submitted',
  follow_up: 'Followed up',
  resubmitted: 'Resubmitted',
  resubmit_queued: 'Resubmission queued',
  response: 'Response',
  payer_skipped: 'Payer skipped',
  statement: 'Patient statement',
  closed: 'Closed'
};

const closedReason = 'This claim is closed.';

export const moveItem = (items: readonly string[], from: number, to: number) => {
  if (to < 0 || to >= items.length) return [...items];
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
};

export const toResponse = (draft: {
  payer: string;
  paid: string;
  adjusted: string;
  note: string;
}): Omit<ClaimResponseInput, 'requestId'> | string => {
  const paidCents = parseDollars(draft.paid || '0');
  const adjustedCents = parseDollars(draft.adjusted || '0');
  if (paidCents === null || adjustedCents === null) return 'Enter amounts of zero or more';
  if (paidCents + adjustedCents === 0 && draft.payer === '') {
    return 'A patient payment needs an amount';
  }
  return { payer: draft.payer || null, paidCents, adjustedCents, note: draft.note.trim() };
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
      <TableRow key={l.code}>
        <TableCell>
          <span className="font-mono font-semibold">{l.code}</span>
        </TableCell>
        <TableCell kind="numeric">{l.units}</TableCell>
        <TableCell kind="numeric" isMuted>
          {formatCents(l.unitCents)}
        </TableCell>
        <TableCell kind="numeric">{formatCents(l.totalCents)}</TableCell>
      </TableRow>
    ))}
  </Table>
);

export const EventsTable = ({
  events,
  documentUrl
}: {
  events: readonly ClaimEvent[];
  documentUrl: (eventId: string) => string;
}) => (
  <Table
    label="Claim history"
    head={['When', 'Event', 'Payer', 'Amount', { label: 'Note', isSecondary: true }]}
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
                className={`inline-flex items-center gap-1 whitespace-nowrap ${textLinkClasses}`}
              >
                <FileTextIcon aria-hidden="true" className="size-3.5" />
                View PDF
              </a>
            ) : null}
          </span>
        </TableCell>
      </TableRow>
    ))}
  </Table>
);

export const PayersEditor = ({
  payers,
  disabled,
  onSave
}: {
  payers: readonly string[];
  disabled: boolean;
  onSave: (payers: string[]) => Promise<void>;
}) => {
  const [list, setList] = useState<string[]>([...payers]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const locked = disabled ? closedReason : undefined;
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
          size="sm"
          isPending={busy}
          disabledReason={locked ?? (isDirty ? undefined : 'No changes to save.')}
          onClick={() => void save()}
        >
          <SaveIcon aria-hidden="true" className="size-4" />
          Save Order
        </Button>
      }
    >
      {list.length ? (
        <ol className="divide-border border-border flex flex-col divide-y rounded-lg border">
          {list.map((p, i) => (
            <li key={p} className="flex items-center justify-between gap-2 py-1 pr-1 pl-3 text-sm">
              <span className="flex min-w-0 items-center gap-3">
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
              </span>
              <span className="flex">
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
                <IconButton
                  label={`Remove ${p}`}
                  icon={Trash2Icon}
                  intent="danger"
                  disabledReason={locked}
                  onClick={() => setList(list.filter((x) => x !== p))}
                />
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyText>No payers yet. The patient will be billed directly.</EmptyText>
      )}
      <form onSubmit={add} className="flex items-end gap-2" aria-label="Add payer">
        <fieldset disabled={disabled} className="flex flex-1 items-end gap-2">
          <div className="flex-1">
            <Input
              id="payer-name"
              label="Add a Payer"
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
  payers,
  current,
  disabled,
  onRecord
}: {
  payers: readonly string[];
  current: string | null;
  disabled: boolean;
  onRecord: (response: ClaimResponseInput) => Promise<boolean>;
}) => {
  const empty = { payer: current ?? '', paid: '', adjusted: '', note: '' };
  const [draft, setDraft] = useState(empty);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (disabled) return;
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
      title="Record a Response"
      description="A payer's remittance, or a payment from the patient."
    >
      <form onSubmit={submit} className="flex flex-col gap-5" aria-label="Record a response">
        <fieldset disabled={disabled || busy} className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
          <Select
            id="response-payer"
            label="From"
            options={[
              ...payers.map((p) => ({ value: p, label: p })),
              { value: '', label: 'Patient' }
            ]}
            {...field('payer')}
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
          <Button
            type="submit"
            isPending={busy}
            disabledReason={disabled ? closedReason : undefined}
          >
            <SaveIcon aria-hidden="true" className="size-4" />
            Record
          </Button>
        </div>
      </form>
    </SectionPanel>
  );
};

export const describeProgress = (progress: ClaimProgress | null) => {
  if (!progress) return null;
  switch (progress.step) {
    case 'submit':
      return `Ready for ${progress.payer}. It goes out in the next 837P batch from Submissions.`;
    case 'await':
      return `Waiting on ${progress.payer}. A follow-up task opens 30 days after submission.`;
    case 'followUp':
      return `${progress.payer} has not responded in 30 days. Follow up from the billing-followup queue.`;
    case 'statement':
      return `Sending patient statement ${progress.statement} of 3.`;
    case 'awaitPatient':
      return 'Waiting on the patient. The next statement goes out 30 days after the last one.';
    case 'collections':
      return 'All payers and statements are done. Decide on the balance from the billing-collections queue.';
    case 'closed':
      return 'Paid in full. Closing.';
  }
};

export const describeCycle = (
  claim: Pick<ClaimDetail, 'status' | 'cycle_status'>,
  progress: ClaimProgress | null
): { intent: Intent; text: string; stopped: boolean; restartable: boolean } | null => {
  if (claim.status !== 'open') return null;
  switch (claim.cycle_status) {
    case null:
      return {
        intent: 'warning',
        text: 'No payer cycle is running for this claim.',
        stopped: true,
        restartable: true
      };
    case 'failed':
    case 'cancelled':
      return {
        intent: 'danger',
        text: `The payer cycle ${claim.cycle_status === 'failed' ? 'failed' : 'was cancelled'}, so nothing more will happen on this claim until it is restarted.`,
        stopped: true,
        restartable: true
      };
    case 'faulted':
      return {
        intent: 'danger',
        text: 'The payer cycle is stuck on an error. Resolve it from the exceptions queue.',
        stopped: true,
        restartable: false
      };
    default: {
      const text = describeProgress(progress);
      return text ? { intent: 'info', text, stopped: false, restartable: false } : null;
    }
  }
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
  return (
    <Alert
      intent={status.intent}
      action={
        runLink || status.restartable ? (
          <>
            {runLink ? (
              <ButtonLink to={`/runs/${runLink}`} variant="outline" size="sm">
                <ExternalLinkIcon aria-hidden="true" className="size-4" />
                Open the cycle run
              </ButtonLink>
            ) : null}
            {status.restartable ? (
              <Button
                variant="outline"
                size="sm"
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
        ) : undefined
      }
    >
      {status.text}
    </Alert>
  );
};

export const ClaimView = ({
  claim,
  events,
  progress,
  onSavePayers,
  onRecord,
  onRestart,
  onSaveData,
  documentUrl,
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
  error?: string;
}) => {
  const closed = claim.status !== 'open';
  const current = progress && 'payer' in progress ? progress.payer : null;
  return (
    <Page
      title={`${claim.last_name}, ${claim.first_name}`}
      backTo="/claims"
      backLabel="Back to Claims"
      description={
        <span className="flex flex-wrap items-center gap-2">
          <ClaimStatusBadge status={claim.status} />
          <span>{claim.pcr_number ?? 'No PCR number'}</span>
        </span>
      }
    >
      {error ? <Alert>{error}</Alert> : null}
      <CycleAlert claim={claim} progress={progress} onRestart={onRestart} />
      <SectionPanel title="Summary">
        <DetailList>
          <Detail label="Total" isEmphasized>
            {formatCents(claim.total_cents)}
          </Detail>
          <Detail label="Balance" isEmphasized>
            {formatCents(claim.balance_cents)}
          </Detail>
          <Detail label="Born">{claim.birth_date}</Detail>
          <Detail label="Transport">
            {claim.level}
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
            key={claim.payers.join('|')}
            payers={claim.payers}
            disabled={closed}
            onSave={onSavePayers}
          />
        </div>
        <ResponseForm
          key={`response-${claim.id}`}
          payers={claim.payers}
          current={current}
          disabled={closed}
          onRecord={onRecord}
        />
      </div>
      <ClaimDataForm key={`data-${claim.id}`} claim={claim} disabled={closed} onSave={onSaveData} />
      <SectionPanel title="History" description="Everything that has happened on this claim.">
        {events.length ? (
          <EventsTable events={events} documentUrl={documentUrl} />
        ) : (
          <EmptyText>Nothing has happened on this claim yet.</EmptyText>
        )}
      </SectionPanel>
    </Page>
  );
};

export const ClaimPage = ({ client, live, claimId }: ClaimPageProps) => {
  const detail = useResource(`claim:${claimId}`, () => client.find(claimId), 15_000);
  useLive(live, detail.reload);
  const [error, setError] = useState('');
  const act = async (action: () => Promise<unknown>) => {
    setError('');
    try {
      await action();
      detail.reload();
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
      error={error}
      claim={detail.data.claim}
      events={detail.data.events}
      progress={detail.data.progress}
      onSavePayers={async (payers) => {
        await act(() => client.setPayers(claimId, payers));
      }}
      onRecord={(response) => act(() => client.recordResponse(claimId, response))}
      onSaveData={(data) => act(() => client.saveBillingData(claimId, data))}
      documentUrl={(eventId) => client.documentUrl(claimId, eventId)}
      onRestart={async () => {
        await act(() => client.restartCycle(claimId));
      }}
    />
  );
};
