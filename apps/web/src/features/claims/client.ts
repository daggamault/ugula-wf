import type { CodeDescriptions } from '@ugula/billing';
import type { Api } from '../../shared/api.ts';
import type { ClaimDetail, ClaimSummary } from '../../shared/claims/claim-detail.ts';
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

export const createClaimsClient = (api: Api) => ({
  list: (query: ClaimQuery, page: string, signal?: AbortSignal) =>
    api.get<Page<ClaimSummary>>(`/api/claims?${listQuery(query, page)}`, signal),
  find: (id: string, signal?: AbortSignal) =>
    api.get<{ claim: ClaimDetail; codes: CodeDescriptions; issues: string[] }>(
      claimPath(id),
      signal
    )
});

export type ClaimsClient = ReturnType<typeof createClaimsClient>;
