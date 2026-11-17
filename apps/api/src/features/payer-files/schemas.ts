import { PAYER_FILE_KINDS } from '@ugula/billing';
import * as v from 'valibot';
import { facetValues } from '../../shared/facets.ts';
import { pageEntries } from '../../shared/paging.ts';

const PAYER_FILE_SORTS = ['received', 'name', 'kind', 'problems'] as const;

export type PayerFileSort = (typeof PAYER_FILE_SORTS)[number];

const PAYER_FILE_OUTCOMES = ['review', 'applied', 'empty'] as const;

export type PayerFileOutcome = (typeof PAYER_FILE_OUTCOMES)[number];

export const searchPayerFilesQuery = v.object({
  kind: facetValues(v.picklist(PAYER_FILE_KINDS)),
  outcome: facetValues(v.picklist(PAYER_FILE_OUTCOMES)),
  ...pageEntries(PAYER_FILE_SORTS, 'received', 'desc')
});

export const payerFileFormSchema = v.object({ file: v.instance(File) });
