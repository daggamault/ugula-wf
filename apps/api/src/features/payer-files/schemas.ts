import * as v from 'valibot';
import { pageEntries } from '../../shared/paging.ts';

const PAYER_FILE_SORTS = ['received', 'name', 'kind', 'problems'] as const;

export type PayerFileSort = (typeof PAYER_FILE_SORTS)[number];

export const listPayerFilesQuery = v.object(pageEntries(PAYER_FILE_SORTS, 'received', 'desc'));

export const payerFileFormSchema = v.object({ file: v.instance(File) });
