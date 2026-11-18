import type { CodeDescriptions, InsuredRelationship, ServiceLevel, Sex } from '@ugula/billing';
import type { Api } from '../../shared/api.ts';
import type { ClaimDetail, ClaimSummary } from '../../shared/claims/claim-detail.ts';
import type { ClaimPayment } from '../../shared/claims/claim-payments.tsx';
import type { Page } from '../../shared/url-state.ts';

export type ClaimSearch = {
  firstName: string;
  lastName: string;
  birthDate: string;
  number: string;
};

type ClaimQuery = Partial<ClaimSearch> & { patientId?: string };

export const claimSearchOf = (query: URLSearchParams): ClaimSearch => ({
  firstName: query.get('firstName') ?? '',
  lastName: query.get('lastName') ?? '',
  birthDate: query.get('birthDate') ?? '',
  number: query.get('number') ?? ''
});

const listQuery = (query: ClaimQuery, page: string) => {
  const filters = new URLSearchParams(
    Object.entries(query).flatMap(([k, v]) => (v?.trim() ? [[k, v.trim()]] : []))
  );
  return [filters.toString(), page].filter(Boolean).join('&');
};

const claimPath = (id: string) => `/api/claims/${encodeURIComponent(id)}`;

type EditedPlace = Record<'name' | 'line' | 'city' | 'state' | 'postalCode', string | null>;

export type ClaimEdit = {
  revision: number;
  serviceDate: string | null;
  level: ServiceLevel;
  emergency: boolean;
  loadedMiles: number | null;
  originCode: string | null;
  destinationCode: string | null;
  transportReason: string | null;
  conditionCodes: string[];
  weightPounds: number | null;
  diagnoses: string[];
  patient: {
    firstName: string;
    lastName: string;
    birthDate: string;
    sex: Sex | null;
    addressLine: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
  };
  pickup: EditedPlace;
  destination: EditedPlace;
  priorAuthorization: string | null;
  signatureOnFile: boolean;
  note: string | null;
  coverages: {
    payerId: string | null;
    payerName: string;
    memberId: string | null;
    groupId: string | null;
    relationship: InsuredRelationship;
    insuredFirstName: string | null;
    insuredLastName: string | null;
  }[];
  lines: { code: string; modifiers: string[]; units: number; unitCents: number }[];
};

export type DirectoryPayer = { id: string; name: string };

export const createClaimsClient = (api: Api) => ({
  list: (query: ClaimQuery, page: string, signal?: AbortSignal) =>
    api.get<Page<ClaimSummary>>(`/api/claims?${listQuery(query, page)}`, signal),
  find: (id: string, signal?: AbortSignal) =>
    api.get<{
      claim: ClaimDetail;
      codes: CodeDescriptions;
      issues: string[];
      payments: ClaimPayment[];
    }>(claimPath(id), signal),
  edit: (id: string, edit: ClaimEdit) =>
    api.put<{ id: string; revision: number }>(claimPath(id), edit),
  payers: async (q: string, signal?: AbortSignal) =>
    (
      await api.get<{ payers: DirectoryPayer[] }>(
        `/api/payers/names${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`,
        signal
      )
    ).payers
});

export type ClaimsClient = ReturnType<typeof createClaimsClient>;
