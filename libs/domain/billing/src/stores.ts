import type { ClaimInput, ClaimReview, ClaimSettlement, StoredClaim } from './claims.ts';
import type { PaymentOutcome } from './inbound.ts';
import type { Address, NewPatient, Patient } from './patients.ts';
import type { DirectoryPayer, Payer, PayerCandidate } from './payers.ts';

type CandidateQuery = {
  birthDate: string | null;
  lastNameKey: string | null;
  firstName: string | null;
};

export type PatientStore = {
  findPatient: (runId: string, patientId: string) => Promise<Patient | null>;
  findCandidates: (runId: string, query: CandidateQuery) => Promise<Patient[]>;
  createPatient: (runId: string, sourceKey: string, patient: NewPatient) => Promise<Patient>;
  updateAddress: (runId: string, patientId: string, address: Address) => Promise<Patient>;
};

export type FeeStore = {
  findFee: (runId: string, payerId: string | null, code: string) => Promise<number | null>;
};

type MatchedPayer = { known: DirectoryPayer | null; similar: PayerCandidate[] };

export type PayerStore = {
  findPayer: (runId: string, payerId: string) => Promise<Payer | null>;
  matchPayer: (runId: string, name: string) => Promise<MatchedPayer>;
};

type SavedClaim = {
  id: string;
  revision: number;
  outcome: 'created' | 'replaced' | 'alreadySent';
};

export type SentClaim =
  | { outcome: 'sent'; fileName: string; controlNumber: number }
  | { outcome: 'selfPay' | 'nothingToSend' }
  | { outcome: 'notReady'; issues: string[] };

export type ClaimStore = {
  findClaim: (runId: string, claimId: string) => Promise<StoredClaim | null>;
  saveClaim: (runId: string, claim: ClaimInput) => Promise<SavedClaim>;
  checkClaim: (runId: string, claimId: string) => Promise<string[] | null>;
  sendClaim: (runId: string, claimId: string) => Promise<SentClaim>;
  reviewClaim: (
    runId: string,
    review: ClaimReview
  ) => Promise<'recorded' | 'superseded' | 'notReady'>;
  settleClaim: (
    runId: string,
    claimId: string,
    settlement: ClaimSettlement,
    note: string | null
  ) => Promise<'settled' | 'changed'>;
};

export type PaymentView = {
  claimId: string;
  claimNumber: string;
  outcome: PaymentOutcome;
  paidCents: number;
  patientCents: number;
  hasNextPayer: boolean;
  reasons: string[];
};

export type RemittanceView = {
  payerName: string | null;
  totalCents: number;
  balanced: boolean;
  unmatched: number;
  reconciled: boolean;
};

type Posted = { remittances: number; posted: number; unmatched: number };

export type ClearinghouseStore = {
  applyAcknowledgments: (
    runId: string,
    fileId: string
  ) => Promise<{ accepted: number; rejected: number }>;
  postRemittance: (runId: string, fileId: string) => Promise<Posted>;
  findPayment: (runId: string, paymentId: string) => Promise<PaymentView | null>;
  findRemittance: (runId: string, remittanceId: string) => Promise<RemittanceView | null>;
  reconcileRemittance: (
    runId: string,
    remittanceId: string,
    reconciledBy: string | null,
    note: string | null
  ) => Promise<void>;
};

type Diagnosis = { code: string; description: string };

type DiagnosisMatch = Diagnosis & { score: number };

export type DiagnosisStore = {
  findBillable: (codes: readonly string[]) => Promise<Diagnosis[]>;
  search: (text: string, limit: number, emsOnly: boolean) => Promise<DiagnosisMatch[]>;
};

export type BillingStores = {
  patients: PatientStore;
  payers: PayerStore;
  fees: FeeStore;
  claims: ClaimStore;
  diagnoses: DiagnosisStore;
  clearinghouse: ClearinghouseStore;
};
