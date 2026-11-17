import * as v from 'valibot';
import { pageEntries } from '../../shared/paging.ts';

const PERIOD_SORTS = ['period'] as const;

export type PeriodSort = (typeof PERIOD_SORTS)[number];

export const searchPeriodsQuery = v.object(pageEntries(PERIOD_SORTS, 'period', 'desc'));
