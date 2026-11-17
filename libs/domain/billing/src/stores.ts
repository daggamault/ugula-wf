import type { CodeSet } from './code-sets.ts';
import type { Hospital } from './facilities.ts';
import type { ZipPlace } from './geo.ts';
import type { MedicareFee, MedicareLocality } from './medicare-fees.ts';
import type { Address, NewPatient, Patient } from './patients.ts';
import type { DirectoryPayer, PayerLookup } from './payers.ts';

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

type FoundCode = { description: string; billable: boolean };

export type ReferenceStore = {
  findCode: (set: CodeSet, code: string) => Promise<FoundCode | null>;
  medicareLocality: (postalCode: string) => Promise<MedicareLocality | null>;
  medicareFees: (
    year: number,
    carrier: string,
    locality: string,
    codes: string[]
  ) => Promise<MedicareFee[]>;
  zipPlace: (postalCode: string) => Promise<ZipPlace | null>;
  findHospital: (
    name: string,
    state: string,
    postalCode: string | null
  ) => Promise<Hospital | null>;
};

export type PayerStore = {
  lookup: (runId: string, names: string[], similar: boolean) => Promise<PayerLookup[]>;
  directory: (runId: string) => Promise<DirectoryPayer[]>;
  linkAlias: (runId: string, name: string, payerId: string) => Promise<boolean>;
  cachedSuggestion: (runId: string, name: string) => Promise<string | null | undefined>;
  cacheSuggestion: (runId: string, name: string, payerId: string | null) => Promise<void>;
};
