import type { NodeDef } from '@ugula/graph';
import type { ClaimPatch } from '../claim-fix.ts';
import type { ClaimCheck, NewClaim } from '../claim-validation.ts';
import type { ClaimLedger, ClaimStatus, ClosedStatus, CycleEventKind } from '../claims.ts';
import type { Completer } from '../completions.ts';
import type { Address, NewPatient, Patient } from '../patients.ts';
import type { PayerFileOutcome } from '../payer-files.ts';
import type { DirectoryPayer, PayerLookup } from '../payers.ts';
import type { StatementData } from '../statements.ts';
import type { InboundKind } from '../x12.ts';
import type { PendingSubmission, Submitter } from '../x837.ts';

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
  updateAddress: (
    runId: string,
    sourceKey: string,
    patientId: string,
    address: Address
  ) => Promise<Patient>;
};

export type FeeStore = {
  findFees: (
    runId: string,
    payerId: string | null,
    codes: string[]
  ) => Promise<Record<string, number>>;
  saveFee: (
    runId: string,
    payerId: string | null,
    code: string,
    unitCents: number
  ) => Promise<void>;
};

export type PayerStore = {
  lookup: (runId: string, names: string[], similar: boolean) => Promise<PayerLookup[]>;
  directory: (runId: string) => Promise<DirectoryPayer[]>;
  linkAlias: (runId: string, name: string, payerId: string) => Promise<boolean>;
  cachedSuggestion: (runId: string, name: string) => Promise<string | null | undefined>;
  cacheSuggestion: (runId: string, name: string, payerId: string | null) => Promise<void>;
};

export type AgencyProfile = StatementData['agency'] & { timeZone: string };

export type StatementSource = Omit<StatementData, 'number' | 'count' | 'issuedOn' | 'agency'> & {
  agency: AgencyProfile | null;
};

export type DraftClaim = {
  pcrNumber: string | null;
  reportKey: string | null;
  claimId: string | null;
};

type OpenedClaim = { id: string; duplicate: boolean };

type TrackedLedger = ClaimLedger & { signalsSeen: number; reference: string };

export type BlobRef = { bucket: string; key: string };

export type SubmissionSource = {
  submitter: Submitter | null;
  pending: PendingSubmission | null;
};

export type SubmissionFile = {
  coverageId: string;
  resubmission: boolean;
  totalCents: number;
  production: boolean;
  build: (controlNumber: number) => string;
};

export type SavedSubmission = { controlNumber: number } | 'stale' | 'exhausted';

export type SentClaimFile = { sentAs: string } | 'manual';

type Revision = { status: ClaimStatus; previous: BlobRef | null };

export type ClaimStore = {
  openDraft: (runId: string, sourceKey: string, draft: DraftClaim) => Promise<OpenedClaim>;
  assignPatient: (
    runId: string,
    claimId: string,
    sourceKey: string,
    patientId: string
  ) => Promise<void>;
  saveClaim: (runId: string, claimId: string, sourceKey: string, claim: NewClaim) => Promise<void>;
  claimCheck: (runId: string, claimId: string) => Promise<ClaimCheck | null>;
  patchClaim: (
    runId: string,
    claimId: string,
    sourceKey: string,
    patch: ClaimPatch
  ) => Promise<void>;
  setStatus: (
    runId: string,
    claimId: string,
    sourceKey: string,
    status: ClaimStatus,
    signalsSeen: number
  ) => Promise<'set' | 'stale'>;
  noteRevision: (
    runId: string,
    claimId: string,
    sourceKey: string,
    report: BlobRef
  ) => Promise<Revision>;
  attachCycle: (
    runId: string,
    claimId: string,
    sourceKey: string,
    cycleRunId: string
  ) => Promise<void>;
  statementData: (runId: string, claimId: string) => Promise<StatementSource>;
  saveStatement: (
    runId: string,
    claimId: string,
    sourceKey: string,
    statement: { number: number; count: number; pdf: Uint8Array }
  ) => Promise<void>;
  ledger: (runId: string, claimId: string) => Promise<TrackedLedger | null>;
  submission: (runId: string, claimId: string) => Promise<SubmissionSource>;
  saveSubmission: (
    runId: string,
    claimId: string,
    sourceKey: string,
    file: SubmissionFile
  ) => Promise<SavedSubmission>;
  sendClaimFile: (runId: string, claimId: string, controlNumber: number) => Promise<SentClaimFile>;
  linkRun: (runId: string, claimId: string) => Promise<void>;
  recordEvent: (
    runId: string,
    claimId: string,
    sourceKey: string,
    event: {
      kind: CycleEventKind;
      coverageId: string | null;
      note: string;
      payerClaimNumber: string | null;
    }
  ) => Promise<void>;
  closeClaim: (
    runId: string,
    claimId: string,
    sourceKey: string,
    status: ClosedStatus
  ) => Promise<void>;
};

export type PayerFileLine = {
  reference: string;
  claimId: string | null;
  outcome: PayerFileOutcome;
  message: string;
};

export type AppliedPayerFile =
  | { status: 'applied'; fileId: string; kind: InboundKind; reviews: PayerFileLine[] }
  | { status: 'duplicate'; fileId: string }
  | { status: 'unreadable'; reason: string };

export type PayerFileStore = {
  apply: (
    runId: string,
    sourceKey: string,
    file: { document: BlobRef; fileName: string }
  ) => Promise<AppliedPayerFile>;
};

export type BillingStores = {
  patients: PatientStore;
  payers: PayerStore;
  fees: FeeStore;
  claims: ClaimStore;
  payerFiles: PayerFileStore;
  completer: Completer;
};

export type StoresOf = () => BillingStores;

export type NodesOf = (stores: StoresOf) => NodeDef[];
