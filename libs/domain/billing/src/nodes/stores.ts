import type { NodeDef } from '@ugula/graph';
import type { ClaimDocument, DocumentKind } from '../claim-documents.ts';
import type { ClaimPatch } from '../claim-fix.ts';
import type { ManualPayment } from '../claim-payments.ts';
import type { ClaimCheck, NewClaim } from '../claim-validation.ts';
import type { ClaimLedger, ClaimStatus, ClosedStatus, CycleEventKind } from '../claims.ts';
import type { Completer } from '../completions.ts';
import type { AppealPacketSource, FacilityInvoiceSource } from '../documents.ts';
import type { CheckedFacility, ResponsibleParty } from '../facilities.ts';
import type { Address, NewPatient, Patient } from '../patients.ts';
import type { PayerFileOutcome } from '../payer-files.ts';
import type { DirectoryPayer, PayerLookup } from '../payers.ts';
import type { RemittanceLine, RemittancePosting } from '../remittances.ts';
import type { StatementData } from '../statements.ts';
import type { InboundKind } from '../x12.ts';
import type { PendingSubmission, Submitter } from '../x837.ts';

type CandidateQuery = {
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

export type FeeSchedules = { payer: Record<string, number>; default: Record<string, number> };

export type FeeStore = {
  findSchedules: (runId: string, payerId: string | null, codes: string[]) => Promise<FeeSchedules>;
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

type AgencyProfile = StatementData['agency'] & { timeZone: string };

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

export type Deadline = {
  kind: string;
  claimId: string;
  coverageId: string | null;
  reference: string;
  dueOn: string;
  daysLeft: number;
  taskId: string | null;
  priority: number;
  reminded: boolean;
};

export type RecoveryStore = {
  recordRefund: (
    runId: string,
    claimId: string,
    sourceKey: string,
    refund: { coverageId: string | null; cents: number; note: string; paidOn: string }
  ) => Promise<void>;
  protectBalance: (
    runId: string,
    claimId: string,
    sourceKey: string,
    protection: { adjustedCents: number; note: string }
  ) => Promise<void>;
  skipRemainingPayers: (
    runId: string,
    claimId: string,
    sourceKey: string,
    note: string
  ) => Promise<void>;
  addPayer: (
    runId: string,
    claimId: string,
    payer: { payerId: string; memberId: string | null }
  ) => Promise<void>;
  appealPacket: (
    runId: string,
    claimId: string,
    coverageId: string
  ) => Promise<Omit<AppealPacketSource, 'level' | 'dueOn'>>;
  saveAppealPacket: (
    runId: string,
    claimId: string,
    sourceKey: string,
    packet: { coverageId: string; note: string; pdf: Uint8Array }
  ) => Promise<void>;
};

export type CalendarStore = {
  today: (runId: string, at: Date) => Promise<string>;
};

export type ScheduleStore = {
  deadlines: (runId: string, today: string) => Promise<Deadline[]>;
  raiseTask: (runId: string, taskId: string, priority: number) => Promise<void>;
  facilityInvoices: (runId: string, period: string) => Promise<FacilityInvoiceSource[]>;
  saveFacilityInvoice: (
    runId: string,
    sourceKey: string,
    invoice: { source: FacilityInvoiceSource; pdf: Uint8Array; totalCents: number }
  ) => Promise<void>;
};

export type BlobRef = { bucket: string; key: string };

export type SubmissionSource = {
  submitter: Submitter | null;
  pending: PendingSubmission | null;
};

type SubmissionFile = {
  coverageId: string;
  resubmission: boolean;
  totalCents: number;
  production: boolean;
  build: (controlNumber: number) => string;
};

export type SavedSubmission = { controlNumber: number } | 'stale' | 'exhausted';

export type SentClaimFile = { sentAs: string } | 'manual';

type Revision = { status: ClaimStatus; previous: BlobRef | null };

export type Responsibility = {
  party: ResponsibleParty;
  facilityId: string | null;
  note: string;
};

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
  submission: (runId: string, claimId: string, coverageId: string) => Promise<SubmissionSource>;
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
  setResponsibility: (
    runId: string,
    claimId: string,
    sourceKey: string,
    responsibility: Responsibility
  ) => Promise<void>;
  facilityDirectory: (runId: string) => Promise<CheckedFacility[]>;
  claimDocument: (
    runId: string,
    claimId: string,
    documentId: string
  ) => Promise<ClaimDocument | null>;
};

export type Refused = { status: 'refused'; reason: string };

export type NewClaimDocument = {
  kind: DocumentKind;
  signedOn: string | null;
  file: BlobRef;
  addedBy: string | null;
};

export type ClaimTaskStore = {
  setPayers: (
    runId: string,
    claimId: string,
    payers: string[]
  ) => Promise<{ status: 'saved' } | Refused>;
  postPayment: (
    runId: string,
    claimId: string,
    sourceKey: string,
    payment: ManualPayment,
    postedBy: string | null
  ) => Promise<{ status: 'posted'; balanceCents: number } | Refused>;
  addDocument: (
    runId: string,
    claimId: string,
    sourceKey: string,
    document: NewClaimDocument
  ) => Promise<{ status: 'added'; documentId: string } | Refused>;
};

type PayerFileLine = {
  reference: string;
  claimId: string | null;
  outcome: PayerFileOutcome;
  message: string;
};

export type AppliedPayerFile =
  | {
      status: 'applied';
      fileId: string;
      kind: InboundKind;
      reviews: PayerFileLine[];
      envelopeRejection: string | null;
    }
  | { status: 'duplicate'; fileId: string }
  | { status: 'unreadable'; reason: string };

export type ReadPayerFile =
  | { status: 'read'; kind: InboundKind; lines: RemittanceLine[] }
  | { status: 'duplicate'; fileId: string }
  | { status: 'unreadable'; reason: string };

type PayerFileRef = { document: BlobRef; fileName: string };

export type PayerFileStore = {
  read: (runId: string, file: PayerFileRef) => Promise<ReadPayerFile>;
  apply: (
    runId: string,
    sourceKey: string,
    file: PayerFileRef & { postings: RemittancePosting[] }
  ) => Promise<AppliedPayerFile>;
};

type Unavailable = { status: 'unavailable'; reason: string };

type SentBatch = { status: 'sent'; sentAs: string; reason: string | null };

export type EligibilityCheck =
  | { status: 'answered'; fileName: string; reviews: PayerFileLine[] }
  | SentBatch
  | Unavailable;

export type ClaimStatusCheck =
  | { status: 'answered'; note: string }
  | (SentBatch & { signalsSeen: number })
  | Unavailable;

export type ExchangeStore = {
  checkEligibility: (
    runId: string,
    claimId: string,
    sourceKey: string,
    force: boolean
  ) => Promise<EligibilityCheck>;
  checkClaimStatus: (
    runId: string,
    claimId: string,
    sourceKey: string,
    coverageId: string
  ) => Promise<ClaimStatusCheck>;
};

export type BillingStores = {
  patients: PatientStore;
  payers: PayerStore;
  fees: FeeStore;
  claims: ClaimStore;
  claimTasks: ClaimTaskStore;
  payerFiles: PayerFileStore;
  exchange: ExchangeStore;
  recovery: RecoveryStore;
  schedules: ScheduleStore;
  calendar: CalendarStore;
  completer: Completer;
};

type StoresOf = () => BillingStores;

export type NodesOf = (stores: StoresOf) => NodeDef[];
