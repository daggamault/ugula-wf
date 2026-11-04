import type { Db } from '@ugula/db';
import { sql } from 'kysely';
import { type PageRequest, paged } from '../../shared/paging.ts';
import type { PayerFileSort } from './schemas.ts';

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

const fileRows = (db: Db, tenantId: string) =>
  db
    .selectFrom('payer_files as f')
    .leftJoin('users as u', 'u.id', 'f.uploaded_by')
    .select([...FILE_COLUMNS, 'u.email as uploaded_by'])
    .where('f.tenant_id', '=', tenantId);

export const listPayerFiles = (db: Db, tenantId: string, page: PageRequest<PayerFileSort>) =>
  paged(fileRows(db, tenantId), page, FILE_ORDER, sql.ref('f.id'));

export const findPayerFile = (db: Db, tenantId: string, id: string) =>
  fileRows(db, tenantId).select('f.document').where('f.id', '=', id).executeTakeFirst();

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
