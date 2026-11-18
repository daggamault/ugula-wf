import type { ClaimInput, ClaimReview } from './claims.ts';
import type { Address, NewPatient, Patient } from './patients.ts';
import type { DirectoryPayer, PayerCandidate } from './payers.ts';

type CandidateQuery = {
  birthDate: string | null;
  lastNameKey: string | null;
  firstName: string | null;
};

export type PatientStore = {
  findCandidates: (runId: string, query: CandidateQuery) => Promise<Patient[]>;
  createPatient: (runId: string, sourceKey: string, patient: NewPatient) => Promise<Patient>;
  updateAddress: (runId: string, patientId: string, address: Address) => Promise<Patient>;
};

export type FeeStore = {
  findFee: (runId: string, payerId: string | null, code: string) => Promise<number | null>;
};

type FoundPayer = { known: DirectoryPayer | null; similar: PayerCandidate[] };

export type PayerStore = {
  findPayer: (runId: string, name: string) => Promise<FoundPayer>;
};

type SavedClaim = { id: string; revision: number; outcome: 'created' | 'replaced' };

export type ClaimStore = {
  saveClaim: (runId: string, claim: ClaimInput) => Promise<SavedClaim>;
  reviewClaim: (runId: string, review: ClaimReview) => Promise<'recorded' | 'superseded'>;
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
};
