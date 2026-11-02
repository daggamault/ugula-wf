import type { NodeDef } from '@ugula/graph';
import type { NewClaim } from '../claim-validation.ts';
import type { ClaimLedger, ClaimStatus, ClosedStatus } from '../claims.ts';
import type { Completer } from '../completions.ts';
import type { NewPatient, Patient } from '../patients.ts';
import type { PayerLookup } from '../payers.ts';
import type { StatementData } from '../statements.ts';

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

export type StatementSource = Omit<StatementData, 'number' | 'issuedOn'>;

export type CycleEventKind =
  | 'resubmit_queued'
  | 'follow_up'
  | 'payer_skipped'
  | 'approved'
  | 'reconciled'
  | 'statement';

export type DraftClaim = { patientId: string; pcrNumber: string | null; reportKey: string | null };

type OpenedClaim = { id: string; duplicate: boolean };

type TrackedLedger = ClaimLedger & { signalsSeen: number; reference: string };

export type BlobRef = { bucket: string; key: string };

export type ClaimStore = {
  findByPcr: (runId: string, pcrNumber: string) => Promise<string | null>;
  openDraft: (runId: string, sourceKey: string, draft: DraftClaim) => Promise<OpenedClaim>;
  saveClaim: (runId: string, claimId: string, claim: NewClaim) => Promise<void>;
  setStatus: (runId: string, claimId: string, status: ClaimStatus) => Promise<void>;
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

export type StoresOf = () => BillingStores;

export type NodesOf = (stores: StoresOf) => NodeDef[];
