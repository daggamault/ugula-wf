import type { Api } from '../../shared/api.ts';
import type { Page } from '../../shared/url-state.ts';

export type Period = {
  period_on: string;
  closed_at: string;
  closed_by: string | null;
};

export const createPeriodsClient = (api: Api) => ({
  search: (query: string, signal?: AbortSignal) =>
    api.get<Page<Period>>(`/api/periods?${query}`, signal)
});

export type PeriodsClient = ReturnType<typeof createPeriodsClient>;
