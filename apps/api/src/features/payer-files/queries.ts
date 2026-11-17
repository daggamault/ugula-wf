import type { InboundKind } from '@ugula/billing';
import type { Db } from '@ugula/db';
import { sql } from 'kysely';
import { facetCounts, whereFacets } from '../../shared/facets.ts';
import { type PageRequest, paged } from '../../shared/paging.ts';
import type { PayerFileOutcome, PayerFileSort } from './schemas.ts';

export type PayerFileFilters = PageRequest<PayerFileSort> & {
  kind: readonly InboundKind[];
  outcome: readonly PayerFileOutcome[];
};

const FILE_COLUMNS = [
  'f.id',
  'f.kind',
  'f.file_name',
  'f.control_number',
  'f.item_count',
  'f.problem_count',
  'f.created_at'
] as const;

const FILE_ORDER = {
  received: sql.ref('f.created_at'),
  name: sql`lower(f.file_name)`,
  kind: sql.ref('f.kind'),
  problems: sql.ref('f.problem_count')
};

const FILE_FACETS = {
  kind: { value: sql.ref('f.kind') },
  outcome: {
    value: sql<PayerFileOutcome>`case when f.problem_count > 0 then 'review' when f.item_count > 0 then 'applied' else 'empty' end`
  }
};

type FileFacet = keyof typeof FILE_FACETS;

const fileRows = (db: Db, agencyId: string) =>
  db
    .selectFrom('payer_files as f')
    .leftJoin('users as u', 'u.id', 'f.uploaded_by_id')
    .select([...FILE_COLUMNS, 'u.email as uploaded_by'])
    .where('f.agency_id', '=', agencyId);

const filteredFiles = (db: Db, agencyId: string, f: PayerFileFilters, except?: FileFacet) =>
  whereFacets(fileRows(db, agencyId), FILE_FACETS, f, except);

export const searchPayerFiles = async (db: Db, agencyId: string, f: PayerFileFilters) => {
  const [page, facets] = await Promise.all([
    paged(filteredFiles(db, agencyId, f), f, FILE_ORDER, sql.ref('f.id')),
    facetCounts((except) => filteredFiles(db, agencyId, f, except), FILE_FACETS)
  ]);
  return { ...page, facets };
};

export const findPayerFile = (db: Db, agencyId: string, id: string) =>
  fileRows(db, agencyId)
    .select([
      'f.document',
      'f.payment_cents',
      'f.payment_method',
      'f.paid_on',
      'f.trace_number',
      'f.trace_payer_id',
      (eb) =>
        eb
          .selectFrom('deposits as d')
          .select('d.id')
          .whereRef('d.payer_file_id', '=', 'f.id')
          .as('deposit_id')
    ])
    .where('f.id', '=', id)
    .executeTakeFirst();

export const listFileItems = (db: Db, fileId: string) =>
  db
    .selectFrom('payer_file_items as i')
    .leftJoin('claims as c', 'c.id', 'i.claim_id')
    .select([
      'i.position',
      'i.reference',
      'i.claim_id',
      'c.number as claim_number',
      'i.outcome',
      'i.message',
      'i.paid_cents',
      'i.adjusted_cents'
    ])
    .where('i.file_id', '=', fileId)
    .orderBy('i.position')
    .execute();
