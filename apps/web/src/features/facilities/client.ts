import type { FacilityKind } from '@ugula/billing';
import type { Api } from '../../shared/api.ts';
import type { Page } from '../../shared/url-state.ts';

export type Facility = {
  id: string;
  name: string;
  address_line: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  phone: string | null;
  kind: FacilityKind;
  has_contract: boolean;
  contract_note: string | null;
  balance_cents: number;
};

export type CmsHospital = {
  ccn: string;
  name: string;
  address_line: string;
  city: string;
  state: string;
  postal_code: string;
  phone: string | null;
  hospital_type: string;
};

export type FacilityInput = {
  name: string;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phone: string | null;
  kind: FacilityKind;
  hasContract: boolean;
  contractNote: string | null;
};

export const createFacilitiesClient = (api: Api) => ({
  search: (query: string, signal?: AbortSignal) =>
    api.get<Page<Facility>>(`/api/facilities?${query}`, signal),
  facility: async (id: string, signal?: AbortSignal) =>
    (await api.get<{ facility: Facility }>(`/api/facilities/${encodeURIComponent(id)}`, signal))
      .facility,
  save: (id: string | null, facility: FacilityInput) =>
    id
      ? api.put<{ id: string }>(`/api/facilities/${encodeURIComponent(id)}`, facility)
      : api.post<{ id: string }>('/api/facilities', facility),
  hospitals: async (q: string, signal?: AbortSignal) =>
    (
      await api.get<{ hospitals: CmsHospital[] }>(
        `/api/facilities/hospitals?${new URLSearchParams({ q })}`,
        signal
      )
    ).hospitals,
  remove: (id: string) => api.remove(`/api/facilities/${encodeURIComponent(id)}`)
});

export type FacilitiesClient = ReturnType<typeof createFacilitiesClient>;
