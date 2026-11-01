import type { Api } from '../../shared/api.ts';
import type { Page } from '../../shared/url-state.ts';

export type PatientSummary = {
  id: string;
  first_name: string;
  last_name: string;
  birth_date: string;
  gender: string | null;
  address_line: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  claim_count: number;
  balance_cents: number;
  last_service_date: string | null;
};

export type PatientSearch = { lastName: string; firstName: string; birthDate: string };

export const PATIENT_FIELDS = ['lastName', 'firstName', 'birthDate'] as const;

export const searchOf = (query: URLSearchParams): PatientSearch => ({
  lastName: query.get('lastName') ?? '',
  firstName: query.get('firstName') ?? '',
  birthDate: query.get('birthDate') ?? ''
});

const searchQuery = (search: PatientSearch) =>
  PATIENT_FIELDS.flatMap((f) =>
    search[f].trim() ? [`${f}=${encodeURIComponent(search[f].trim())}`] : []
  ).join('&');

export const createPatientsClient = (api: Api) => ({
  list: (search: PatientSearch, page: string) => {
    const filters = searchQuery(search);
    return api.get<Page<PatientSummary>>(`/api/patients?${filters ? `${filters}&` : ''}${page}`);
  },
  find: async (id: string) =>
    (await api.get<{ patient: PatientSummary }>(`/api/patients/${id}`)).patient
});

export type PatientsClient = ReturnType<typeof createPatientsClient>;
