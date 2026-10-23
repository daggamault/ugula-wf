import {
  isServiceLevel,
  type PricedLine,
  priceLines,
  readLines,
  readPricedLines,
  SERVICE_LEVELS
} from './charges.ts';
import {
  type ClaimDetails,
  type Coverage,
  readClaimDetails,
  readCoverages
} from './claim-details.ts';
import { type ClaimLedger, claimProgress, nextClaimStep } from './claims.ts';
import type { Completer } from './completions.ts';
import { nameKey } from './names.ts';
import { readNarrative } from './narrative.ts';
import {
  matchPatient,
  type NewPatient,
  type Patient,
  readDemographics,
  toNewPatient
} from './patients.ts';
import { type PayerLookup, payerDocument, suggestPayer } from './payers.ts';
import { renderStatement, type StatementData } from './statements.ts';

type ValueType =
  | 'any'
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'datetime'
  | { list: ValueType }
  | { object: Record<string, ValueType> };

type Pin = { name: string; type: ValueType; optional?: boolean };

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type CandidateQuery = {
  birthDate: string | null;
  lastNameKey: string | null;
  firstName: string | null;
};

export type PatientStore = {
  findCandidates: (runId: string, query: CandidateQuery) => Promise<Patient[]>;
  findPatient: (runId: string, id: string) => Promise<Patient | null>;
  createPatient: (
    runId: string,
    sourceKey: string,
    patient: NewPatient,
    reuseMatch: boolean
  ) => Promise<Patient>;
};

export type FeeStore = {
  findFees: (
    runId: string,
    payerId: string | null,
    codes: string[]
  ) => Promise<Record<string, number>>;
};

export type PayerStore = {
  lookup: (runId: string, names: string[]) => Promise<PayerLookup[]>;
  linkAlias: (runId: string, name: string, payerId: string) => Promise<void>;
};

export type NewClaim = {
  patientId: string;
  pcrNumber: string | null;
  level: string;
  emergency: boolean;
  loadedMiles: number | null;
  lines: PricedLine[];
  totalCents: number;
  coverages: Coverage[];
  details: ClaimDetails;
  reportKey: string | null;
};

export type StatementSource = Omit<StatementData, 'number' | 'issuedOn'>;

export type CycleEventKind = 'resubmit_queued' | 'follow_up' | 'payer_skipped' | 'statement';

export type ClosedStatus = 'paid' | 'written_off' | 'collections';

export type OpenedClaim = { id: string; duplicate: boolean };

export type TrackedLedger = ClaimLedger & { signalsSeen: number; reference: string };

export type BlobRef = { bucket: string; key: string };

export type ClaimStore = {
  findByPcr: (runId: string, pcrNumber: string) => Promise<string | null>;
  openClaim: (runId: string, sourceKey: string, claim: NewClaim) => Promise<OpenedClaim>;
  noteRevision: (
    runId: string,
    claimId: string,
    sourceKey: string,
    report: BlobRef
  ) => Promise<void>;
  attachCycle: (runId: string, claimId: string, cycleRunId: string) => Promise<void>;
  statementData: (runId: string, claimId: string) => Promise<StatementSource>;
  saveStatement: (
    runId: string,
    claimId: string,
    sourceKey: string,
    statement: { number: number; pdf: Uint8Array }
  ) => Promise<void>;
  ledger: (runId: string, claimId: string) => Promise<TrackedLedger | null>;
  recordEvent: (
    runId: string,
    claimId: string,
    sourceKey: string,
    event: { kind: CycleEventKind; coverageId: string | null; note: string }
  ) => Promise<void>;
  closeClaim: (
    runId: string,
    claimId: string,
    sourceKey: string,
    status: ClosedStatus
  ) => Promise<void>;
};

export type BillingStores = {
  patients: PatientStore;
  payers: PayerStore;
  fees: FeeStore;
  claims: ClaimStore;
  completer: Completer;
};

export type HostNode = {
  type: string;
  version: number;
  title: string;
  category: string;
  description: string;
  effect: boolean;
  signature: { execIn: string[]; execOut: string[]; inputs: Pin[]; outputs: Pin[] };
  run: (inv: {
    read: (pin: string) => Promise<unknown>;
    ctx: { runId: string; key: string; now: Date };
  }) => Promise<{ type: 'next'; pin: string; outputs: Record<string, Json> }>;
};

const PATIENT: ValueType = {
  object: { id: 'string', firstName: 'string', lastName: 'string', birthDate: 'string' }
};

const BLOB: ValueType = { object: { bucket: 'string', key: 'string' } };

const DEMOGRAPHICS: Pin = { name: 'demographics', type: { object: {} } };

const PATIENT_OUT: Pin = { name: 'patient', type: PATIENT };

const CYCLE_KINDS: readonly CycleEventKind[] = [
  'resubmit_queued',
  'follow_up',
  'payer_skipped',
  'statement'
];

const PAYER_ACTIONS: readonly CycleEventKind[] = ['resubmit_queued', 'follow_up', 'payer_skipped'];

const CLOSED_STATUSES: readonly ClosedStatus[] = ['paid', 'written_off', 'collections'];

const isRecordValue = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === 'object' && !Array.isArray(x);

const textOrNull = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : null);

export const readNewClaim = (
  patient: unknown,
  summary: unknown,
  charges: unknown,
  report: unknown = null
): NewClaim => {
  const p = isRecordValue(patient) ? patient : {};
  const s = isRecordValue(summary) ? summary : {};
  const c = isRecordValue(charges) ? charges : {};
  if (typeof p.id !== 'string') throw new Error('A claim needs a patient');
  if (!isServiceLevel(c.level)) {
    throw new Error(`A claim needs a level of service: ${SERVICE_LEVELS.join(', ')}`);
  }
  if (typeof c.totalCents !== 'number' || !Number.isInteger(c.totalCents) || c.totalCents < 0) {
    throw new Error('A claim needs a priced total');
  }
  const r = isRecordValue(report) ? report : {};
  return {
    patientId: p.id,
    pcrNumber: textOrNull(s.pcrNumber),
    level: c.level,
    emergency: c.emergency === true,
    loadedMiles: typeof c.loadedMiles === 'number' ? c.loadedMiles : null,
    lines: readPricedLines(c.lines),
    totalCents: c.totalCents,
    coverages: readCoverages(s),
    details: readClaimDetails(s),
    reportKey: textOrNull(r.key)
  };
};

const claimIdOf = async (read: (pin: string) => Promise<unknown>) => {
  const id = await read('claimId');
  if (typeof id !== 'string' || !id) throw new Error('No claim to work on');
  return id;
};

const resolveCoverage = async (
  completer: Completer,
  c: Coverage,
  { known, candidates }: PayerLookup,
  suggest: boolean
) => {
  const coverage = { ...c, payerId: known?.id ?? null, directoryName: known?.name ?? null };
  if (known || !candidates.length) return { coverage, unmatched: null };
  const suggested = suggest ? await suggestPayer(completer, c.payer, candidates) : null;
  const ordered = suggested
    ? [suggested, ...candidates.filter((p) => p.id !== suggested.id)]
    : candidates;
  return {
    coverage,
    unmatched: {
      payer: c.payer,
      memberId: c.memberId,
      suggested: suggested?.id ?? null,
      candidates: ordered.map((p) => ({
        value: p.id,
        label: p === suggested ? `${payerDocument(p)} · suggested` : payerDocument(p)
      }))
    }
  };
};

const action = (inputs: Pin[], outputs: Pin[], execOut = ['then']) => ({
  execIn: ['exec'],
  execOut,
  inputs,
  outputs
});

export const createBillingNodes = (stores: BillingStores | null): HostNode[] => {
  const storesOrFail = () => {
    if (!stores) throw new Error('Billing nodes need storage, which only the worker provides');
    return stores;
  };
  const patients = () => storesOrFail().patients;
  return [
    {
      type: 'billing.match-patient',
      version: 1,
      title: 'Match Patient',
      category: 'Billing',
      description:
        'Finds the existing patient with the same last name, birth date and first name or nickname, or flags likely matches (similar names, birth date typos) for review. Also outputs the cleaned demographics.',
      effect: false,
      signature: action(
        [DEMOGRAPHICS],
        [
          PATIENT_OUT,
          { name: 'candidates', type: { list: PATIENT } },
          { name: 'reason', type: 'string' },
          { name: 'demographics', type: { object: {} } }
        ],
        ['matched', 'unmatched', 'review']
      ),
      run: async ({ read, ctx }) => {
        const d = readDemographics(await read('demographics'));
        const candidates = await patients().findCandidates(ctx.runId, {
          birthDate: d.birthDate,
          lastNameKey: d.lastName ? nameKey(d.lastName) || null : null,
          firstName: d.firstName
        });
        const decision = matchPatient(d, candidates);
        return {
          type: 'next',
          pin: decision.kind,
          outputs: {
            patient: decision.kind === 'matched' ? decision.patient : null,
            candidates: decision.kind === 'review' ? decision.candidates : [],
            reason: decision.kind === 'review' ? decision.reason : '',
            demographics: d
          }
        };
      }
    },
    {
      type: 'billing.create-patient',
      version: 1,
      title: 'Create Patient',
      category: 'Billing',
      description:
        'Creates a patient from report demographics, once per run step. With reuseMatch, returns the patient another run created for the same person instead.',
      effect: true,
      signature: action(
        [DEMOGRAPHICS, { name: 'reuseMatch', type: 'boolean', optional: true }],
        [PATIENT_OUT]
      ),
      run: async ({ read, ctx }) => {
        const patient = toNewPatient(readDemographics(await read('demographics')));
        if (!patient) {
          throw new Error('A patient needs a first name, last name and valid birth date');
        }
        return {
          type: 'next',
          pin: 'then',
          outputs: {
            patient: await patients().createPatient(
              ctx.runId,
              ctx.key,
              patient,
              (await read('reuseMatch')) === true
            )
          }
        };
      }
    },
    {
      type: 'billing.find-patient',
      version: 1,
      title: 'Find Patient',
      category: 'Billing',
      description: 'Loads an existing patient by id, such as the one a biller picked in a task.',
      effect: false,
      signature: action([{ name: 'patientId', type: 'string' }], [PATIENT_OUT]),
      run: async ({ read, ctx }) => {
        const id = await read('patientId');
        if (typeof id !== 'string' || !id) throw new Error('Choose a patient');
        const patient = await patients().findPatient(ctx.runId, id);
        if (!patient) throw new Error(`Patient ${id} does not exist`);
        return { type: 'next', pin: 'then', outputs: { patient } };
      }
    },
    {
      type: 'billing.price-claim',
      version: 1,
      title: 'Price Claim',
      category: 'Billing',
      description:
        "Prices HCPCS claim lines from the tenant's fee schedule, using the directory payer's prices where they exist.",
      effect: false,
      signature: action(
        [
          { name: 'lines', type: { list: { object: { code: 'string', units: 'number' } } } },
          { name: 'payerId', type: 'string', optional: true }
        ],
        [
          {
            name: 'lines',
            type: {
              list: {
                object: {
                  code: 'string',
                  units: 'number',
                  unitCents: 'integer',
                  totalCents: 'integer'
                }
              }
            }
          },
          { name: 'totalCents', type: 'integer' }
        ]
      ),
      run: async ({ read, ctx }) => {
        const lines = readLines(await read('lines'));
        const fees = await storesOrFail().fees.findFees(
          ctx.runId,
          textOrNull(await read('payerId')),
          [...new Set(lines.map((l) => l.code))]
        );
        const claim = priceLines(lines, fees);
        return { type: 'next', pin: 'then', outputs: claim };
      }
    },
    {
      type: 'billing.open-claim',
      version: 1,
      title: 'Open Claim',
      category: 'Billing',
      description:
        'Records a priced claim for a patient, with its charge lines, payers in billing priority, member IDs, service date, pickup and destination, and diagnoses from the report summary, linked to the imported report it came from. Once per run step. Continues through duplicate with the existing claim when its PCR number was already billed.',
      effect: true,
      signature: action(
        [
          { name: 'patient', type: PATIENT },
          { name: 'summary', type: { object: {} } },
          { name: 'charges', type: { object: {} } },
          { name: 'report', type: BLOB, optional: true }
        ],
        [{ name: 'claimId', type: 'string' }],
        ['opened', 'duplicate']
      ),
      run: async ({ read, ctx }) => {
        const claim = readNewClaim(
          await read('patient'),
          await read('summary'),
          await read('charges'),
          await read('report')
        );
        const { id, duplicate } = await storesOrFail().claims.openClaim(ctx.runId, ctx.key, claim);
        return { type: 'next', pin: duplicate ? 'duplicate' : 'opened', outputs: { claimId: id } };
      }
    },
    {
      type: 'billing.find-claim',
      version: 1,
      title: 'Find Claim',
      category: 'Billing',
      description:
        'Looks up the claim already opened for a PCR number, so a re-imported or corrected report is not billed twice.',
      effect: false,
      signature: action(
        [{ name: 'pcrNumber', type: 'string', optional: true }],
        [{ name: 'claimId', type: 'string' }],
        ['found', 'new']
      ),
      run: async ({ read, ctx }) => {
        const pcrNumber = textOrNull(await read('pcrNumber'));
        const claimId = pcrNumber
          ? await storesOrFail().claims.findByPcr(ctx.runId, pcrNumber)
          : null;
        return { type: 'next', pin: claimId ? 'found' : 'new', outputs: { claimId } };
      }
    },
    {
      type: 'billing.note-revision',
      version: 1,
      title: 'Note PCR Revision',
      category: 'Billing',
      description:
        'Logs on a claim that an updated version of its patient care report arrived, with the new report attached. Once per run step.',
      effect: true,
      signature: action(
        [
          { name: 'claimId', type: 'string' },
          { name: 'report', type: BLOB }
        ],
        []
      ),
      run: async ({ read, ctx }) => {
        const claimId = await claimIdOf(read);
        const report = (await read('report')) as BlobRef;
        await storesOrFail().claims.noteRevision(ctx.runId, claimId, ctx.key, report);
        return { type: 'next', pin: 'then', outputs: {} };
      }
    },
    {
      type: 'billing.match-payers',
      version: 1,
      title: 'Match Payers',
      category: 'Billing',
      description:
        "Links the report's payers to the payer directory by name or a name billers already matched. For other names it finds similar directory payers by embedding and, with suggest, has the language model pick the likely one; those continue through review for a biller to confirm.",
      effect: false,
      signature: action(
        [
          { name: 'summary', type: { object: {} } },
          { name: 'suggest', type: 'boolean', optional: true }
        ],
        [
          { name: 'coverages', type: { list: { object: { payer: 'string' } } } },
          {
            name: 'unmatched',
            type: { list: { object: { payer: 'string', candidates: { list: { object: {} } } } } }
          }
        ],
        ['matched', 'review']
      ),
      run: async ({ read, ctx }) => {
        const coverages = readCoverages(await read('summary'));
        const lookups = await storesOrFail().payers.lookup(
          ctx.runId,
          coverages.map((c) => c.payer)
        );
        const suggest = (await read('suggest')) !== false;
        const resolved = await Promise.all(
          coverages.map((c, i) =>
            resolveCoverage(
              storesOrFail().completer,
              c,
              lookups[i] ?? { name: c.payer, known: null, candidates: [] },
              suggest
            )
          )
        );
        const unmatched = resolved.flatMap((r) => (r.unmatched ? [r.unmatched] : []));
        return {
          type: 'next',
          pin: unmatched.length ? 'review' : 'matched',
          outputs: { coverages: resolved.map((r) => r.coverage), unmatched }
        };
      }
    },
    {
      type: 'billing.link-payer',
      version: 1,
      title: 'Link Payer Alias',
      category: 'Billing',
      description:
        'Remembers that a payer name from reports means a directory payer, so later reports with that name link automatically.',
      effect: true,
      signature: action(
        [
          { name: 'name', type: 'string' },
          { name: 'payerId', type: 'string' }
        ],
        []
      ),
      run: async ({ read, ctx }) => {
        const name = textOrNull(await read('name'));
        const payerId = textOrNull(await read('payerId'));
        if (!name || !payerId) throw new Error('Choose the directory payer to link');
        await storesOrFail().payers.linkAlias(ctx.runId, name, payerId);
        return { type: 'next', pin: 'then', outputs: {} };
      }
    },
    {
      type: 'billing.read-narrative',
      version: 1,
      title: 'Read Narrative',
      category: 'Billing',
      description:
        'Uses the local language model to list the medication doses (with routes) and CMS ALS2 procedures the crew documented in the PCR narrative. Suggestions only; a biller confirms the level of service.',
      effect: false,
      signature: action(
        [{ name: 'narrative', type: 'string', optional: true }],
        [
          {
            name: 'findings',
            type: {
              object: {
                medications: { list: { object: {} } },
                procedures: { list: 'string' },
                ivDoses: 'integer'
              }
            }
          }
        ]
      ),
      run: async ({ read }) => {
        const narrative = textOrNull(await read('narrative')) ?? '';
        const findings = await readNarrative(storesOrFail().completer, narrative);
        return { type: 'next', pin: 'then', outputs: { findings } };
      }
    },
    {
      type: 'billing.attach-cycle',
      version: 1,
      title: 'Attach Claim Cycle',
      category: 'Billing',
      description:
        'Links a claim to the run that cycles it through payers, so its status can be shown.',
      effect: true,
      signature: action(
        [
          { name: 'claimId', type: 'string' },
          { name: 'cycleRunId', type: 'string' }
        ],
        []
      ),
      run: async ({ read, ctx }) => {
        const claimId = await claimIdOf(read);
        const cycleRunId = await read('cycleRunId');
        if (typeof cycleRunId !== 'string' || !cycleRunId)
          throw new Error('No cycle run to attach');
        await storesOrFail().claims.attachCycle(ctx.runId, claimId, cycleRunId);
        return { type: 'next', pin: 'then', outputs: {} };
      }
    },
    {
      type: 'billing.claim-step',
      version: 1,
      title: 'Claim Step',
      category: 'Billing',
      description:
        "Decides what a claim needs next from its history: wait for the next payer's claim to go out in an 837P batch, wait out the payer's 30 days, follow up, send or wait on a patient statement, collections review, or close. Also outputs how many claim signals the history already reflects, and the claim's PCR number and patient for people to recognize it by.",
      effect: false,
      signature: action(
        [{ name: 'claimId', type: 'string' }],
        [
          { name: 'coverageId', type: 'string' },
          { name: 'payer', type: 'string' },
          { name: 'statementNumber', type: 'integer' },
          { name: 'balanceCents', type: 'integer' },
          { name: 'waitMs', type: 'integer' },
          { name: 'signalsSeen', type: 'integer' },
          { name: 'reference', type: 'string' }
        ],
        ['submit', 'await', 'followUp', 'statement', 'awaitPatient', 'collections', 'closed']
      ),
      run: async ({ read, ctx }) => {
        const claimId = await claimIdOf(read);
        const ledger = await storesOrFail().claims.ledger(ctx.runId, claimId);
        if (!ledger) throw new Error(`Claim ${claimId} does not exist`);
        const next = nextClaimStep(ledger, ctx.now);
        return {
          type: 'next',
          pin: next.step,
          outputs: {
            coverageId: 'coverage' in next ? next.coverage.id : null,
            payer: 'coverage' in next ? next.coverage.payer : null,
            statementNumber: 'statement' in next ? next.statement : null,
            balanceCents: next.balanceCents,
            waitMs: 'waitMs' in next ? next.waitMs : null,
            signalsSeen: ledger.signalsSeen,
            reference: ledger.reference
          }
        };
      }
    },
    {
      type: 'billing.record-claim-event',
      version: 1,
      title: 'Record Claim Event',
      category: 'Billing',
      description:
        'Logs a queued resubmission, follow-up, skipped payer or patient statement on a claim, once per run step. Follow-up actions for a payer who has already answered are ignored.',
      effect: true,
      signature: action(
        [
          { name: 'claimId', type: 'string' },
          { name: 'kind', type: 'string' },
          { name: 'coverageId', type: 'string', optional: true },
          { name: 'note', type: 'string', optional: true }
        ],
        []
      ),
      run: async ({ read, ctx }) => {
        const claimId = await claimIdOf(read);
        const kind = await read('kind');
        if (!CYCLE_KINDS.includes(kind as CycleEventKind)) {
          throw new Error(`Unknown claim event "${String(kind)}"`);
        }
        const coverageId = textOrNull(await read('coverageId'));
        if (PAYER_ACTIONS.includes(kind as CycleEventKind)) {
          const ledger = await storesOrFail().claims.ledger(ctx.runId, claimId);
          if (ledger && claimProgress(ledger).coverage?.id !== coverageId) {
            return { type: 'next', pin: 'then', outputs: {} };
          }
        }
        await storesOrFail().claims.recordEvent(ctx.runId, claimId, ctx.key, {
          kind: kind as CycleEventKind,
          coverageId,
          note: textOrNull(await read('note')) ?? ''
        });
        return { type: 'next', pin: 'then', outputs: {} };
      }
    },
    {
      type: 'billing.issue-statement',
      version: 1,
      title: 'Issue Patient Statement',
      category: 'Billing',
      description:
        "Renders a PDF statement of the claim's charges, payments and balance due, stores it and logs it on the claim. Needs the tenant's billing profile.",
      effect: true,
      signature: action(
        [
          { name: 'claimId', type: 'string' },
          { name: 'statementNumber', type: 'integer' }
        ],
        []
      ),
      run: async ({ read, ctx }) => {
        const claimId = await claimIdOf(read);
        const number = await read('statementNumber');
        if (typeof number !== 'number' || !Number.isInteger(number) || number < 1) {
          throw new Error('A statement needs a number');
        }
        const claims = storesOrFail().claims;
        const source = await claims.statementData(ctx.runId, claimId);
        const pdf = await renderStatement({
          ...source,
          number,
          issuedOn: ctx.now.toISOString().slice(0, 10)
        });
        await claims.saveStatement(ctx.runId, claimId, ctx.key, { number, pdf });
        return { type: 'next', pin: 'then', outputs: {} };
      }
    },
    {
      type: 'billing.close-claim',
      version: 1,
      title: 'Close Claim',
      category: 'Billing',
      description:
        'Closes a claim as written off or sent to collections, or as paid if its balance has reached zero by then.',
      effect: true,
      signature: action(
        [
          { name: 'claimId', type: 'string' },
          { name: 'status', type: 'string' }
        ],
        []
      ),
      run: async ({ read, ctx }) => {
        const claimId = await claimIdOf(read);
        const status = await read('status');
        if (!CLOSED_STATUSES.includes(status as ClosedStatus)) {
          throw new Error(`Unknown claim status "${String(status)}"`);
        }
        await storesOrFail().claims.closeClaim(ctx.runId, claimId, ctx.key, status as ClosedStatus);
        return { type: 'next', pin: 'then', outputs: {} };
      }
    }
  ];
};
