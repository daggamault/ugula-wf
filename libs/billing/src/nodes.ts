import { type PricedLine, priceLines, readLines, readPricedLines } from './charges.ts';
import {
  type ClaimDetails,
  type Coverage,
  readClaimDetails,
  readCoverages
} from './claim-details.ts';
import { type ClaimLedger, claimProgress, nextClaimStep } from './claims.ts';
import {
  matchPatient,
  type NewPatient,
  nameKey,
  type Patient,
  readDemographics,
  toNewPatient
} from './patients.ts';
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
    payer: string | null,
    codes: string[]
  ) => Promise<Record<string, number>>;
};

export type NewClaim = {
  patientId: string;
  pcrNumber: string | null;
  level: string;
  emergency: boolean;
  loadedMiles: number | null;
  lines: PricedLine[];
  totalCents: number;
  payers: string[];
  coverages: Coverage[];
  details: ClaimDetails;
};

export type StatementSource = Omit<StatementData, 'number' | 'issuedOn'>;

export type CycleEventKind = 'resubmit_queued' | 'follow_up' | 'payer_skipped' | 'statement';

export type ClosedStatus = 'paid' | 'written_off' | 'collections';

export type ClaimStore = {
  openClaim: (runId: string, sourceKey: string, claim: NewClaim) => Promise<string>;
  attachCycle: (runId: string, claimId: string, cycleRunId: string) => Promise<void>;
  statementData: (runId: string, claimId: string) => Promise<StatementSource>;
  saveStatement: (
    runId: string,
    claimId: string,
    sourceKey: string,
    statement: { number: number; pdf: Uint8Array }
  ) => Promise<void>;
  ledger: (runId: string, claimId: string) => Promise<ClaimLedger | null>;
  recordEvent: (
    runId: string,
    claimId: string,
    sourceKey: string,
    event: { kind: CycleEventKind; payer: string | null; note: string }
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
  fees: FeeStore;
  claims: ClaimStore;
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

export const readNewClaim = (patient: unknown, summary: unknown, charges: unknown): NewClaim => {
  const p = isRecordValue(patient) ? patient : {};
  const s = isRecordValue(summary) ? summary : {};
  const c = isRecordValue(charges) ? charges : {};
  if (typeof p.id !== 'string') throw new Error('A claim needs a patient');
  if (typeof c.level !== 'string' || !c.level) throw new Error('A claim needs a level of service');
  if (typeof c.totalCents !== 'number' || !Number.isInteger(c.totalCents) || c.totalCents < 0) {
    throw new Error('A claim needs a priced total');
  }
  const lines = readPricedLines(c.lines);
  const coverages = readCoverages(s);
  return {
    patientId: p.id,
    pcrNumber: textOrNull(s.pcrNumber),
    level: c.level,
    emergency: c.emergency === true,
    loadedMiles: typeof c.loadedMiles === 'number' ? c.loadedMiles : null,
    lines,
    totalCents: c.totalCents,
    payers: coverages.map((cov) => cov.payer),
    coverages,
    details: readClaimDetails(s)
  };
};

const claimIdOf = async (read: (pin: string) => Promise<unknown>) => {
  const id = await read('claimId');
  if (typeof id !== 'string' || !id) throw new Error('No claim to work on');
  return id;
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
        'Finds the existing patient by last name, birth date and first initial, or flags near matches for review. Also outputs the cleaned demographics.',
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
      description: 'Loads an existing patient by id.',
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
        "Prices HCPCS claim lines from the tenant's fee schedule, using the payer's prices where they exist.",
      effect: false,
      signature: action(
        [
          { name: 'lines', type: { list: { object: { code: 'string', units: 'number' } } } },
          { name: 'payer', type: 'string', optional: true }
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
        const payer = await read('payer');
        const fees = await storesOrFail().fees.findFees(
          ctx.runId,
          typeof payer === 'string' && payer ? payer : null,
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
        'Records a priced claim for a patient, with its payers in billing priority, member IDs, service date, pickup and destination, and diagnoses from the report summary. Once per run step.',
      effect: true,
      signature: action(
        [
          { name: 'patient', type: PATIENT },
          { name: 'summary', type: { object: {} } },
          { name: 'charges', type: { object: {} } }
        ],
        [{ name: 'claimId', type: 'string' }]
      ),
      run: async ({ read, ctx }) => {
        const claim = readNewClaim(
          await read('patient'),
          await read('summary'),
          await read('charges')
        );
        const claimId = await storesOrFail().claims.openClaim(ctx.runId, ctx.key, claim);
        return { type: 'next', pin: 'then', outputs: { claimId } };
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
        "Decides what a claim needs next from its history: wait for the next payer's claim to go out in an 837P batch, wait (at most a day before checking again), follow up after 30 days, send or wait on a patient statement, collections review, or close.",
      effect: false,
      signature: action(
        [{ name: 'claimId', type: 'string' }],
        [
          { name: 'payer', type: 'string' },
          { name: 'statementNumber', type: 'integer' },
          { name: 'balanceCents', type: 'integer' },
          { name: 'waitMs', type: 'integer' }
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
            payer: 'payer' in next ? next.payer : null,
            statementNumber: 'statement' in next ? next.statement : null,
            balanceCents: next.balanceCents,
            waitMs: 'waitMs' in next ? next.waitMs : null
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
          { name: 'payer', type: 'string', optional: true },
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
        const payer = textOrNull(await read('payer'));
        if (PAYER_ACTIONS.includes(kind as CycleEventKind)) {
          const ledger = await storesOrFail().claims.ledger(ctx.runId, claimId);
          if (ledger && claimProgress(ledger).payer !== payer) {
            return { type: 'next', pin: 'then', outputs: {} };
          }
        }
        await storesOrFail().claims.recordEvent(ctx.runId, claimId, ctx.key, {
          kind: kind as CycleEventKind,
          payer,
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
