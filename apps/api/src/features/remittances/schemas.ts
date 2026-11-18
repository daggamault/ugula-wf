import * as v from 'valibot';
import { facetValues } from '../../shared/facets.ts';
import { pageEntries } from '../../shared/paging.ts';
import { searchText } from '../../shared/search.ts';

const REMITTANCE_SORTS = ['received', 'paid', 'payer', 'total'] as const;

export type RemittanceSort = (typeof REMITTANCE_SORTS)[number];

const REMITTANCE_STATES = ['reconciled', 'open'] as const;

export const searchRemittancesQuery = v.object({
  q: searchText,
  state: facetValues(v.picklist(REMITTANCE_STATES)),
  ...pageEntries(REMITTANCE_SORTS, 'received', 'desc')
});
