import type { InboundKind, PayerFileOutcome } from '@ugula/billing';
import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';
import { type PageRequest, paged } from '../../shared/paging.ts';
import type { PayerFileSort } from './schemas.ts';

type Db = Kysely<Database>;

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

export const findImported = (db: Db, tenantId: string, digest: string) =>
  db
    .selectFrom('payer_files')
    .select(['id', 'created_at'])
    .where('tenant_id', '=', tenantId)
    .where('digest', '=', digest)
    .executeTakeFirst();

export const insertPayerFile = (
  db: Db,
  f: {
    tenantId: string;
    kind: InboundKind;
    fileName: string;
    digest: string;
    document: unknown;
    controlNumber: string | null;
    uploadedBy: string;
  }
) =>
  db
    .insertInto('payer_files')
    .values({
      tenant_id: f.tenantId,
      kind: f.kind,
      file_name: f.fileName,
      digest: f.digest,
      document: JSON.stringify(f.document),
      control_number: f.controlNumber,
      uploaded_by: f.uploadedBy
    })
    .returning('id')
    .executeTakeFirstOrThrow();

export type FileItem = {
  reference: string;
  claimId: string | null;
  outcome: PayerFileOutcome;
  message: string;
  paidCents: number | null;
  adjustedCents: number | null;
};

export const saveFileItems = async (
  db: Db,
  fileId: string,
  items: readonly FileItem[],
  problems: number
) => {
  if (items.length) {
    await db
      .insertInto('payer_file_items')
      .values(
        items.map((item, i) => ({
          file_id: fileId,
          position: i + 1,
          reference: item.reference,
          claim_id: item.claimId,
          outcome: item.outcome,
          message: item.message,
          paid_cents: item.paidCents,
          adjusted_cents: item.adjustedCents
        }))
      )
      .execute();
  }
  await db
    .updateTable('payer_files')
    .set({ item_count: items.length, problem_count: problems })
    .where('id', '=', fileId)
    .execute();
};

const claimNumberOf = (reference: string) => {
  const n = Number(reference.trim());
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

export const findClaimByNumber = (db: Db, tenantId: string, reference: string) => {
  const number = claimNumberOf(reference);
  return number === null
    ? Promise.resolve(undefined)
    : db
        .selectFrom('claims')
        .select(['id', 'status'])
        .where('tenant_id', '=', tenantId)
        .where('number', '=', number)
        .executeTakeFirst();
};

export const listPostingCoverages = (db: Db, claimId: string) =>
  db
    .selectFrom('claim_coverages as cc')
    .leftJoin('payers as dp', 'dp.id', 'cc.payer_id')
    .select(['cc.id', 'dp.payer_id as payerId'])
    .where('cc.claim_id', '=', claimId)
    .orderBy('cc.position')
    .execute();

const SUBMISSIONS = ['submitted', 'resubmitted'] as const;

export const lastSubmittedCoverage = async (db: Db, claimId: string) =>
  (
    await db
      .selectFrom('claim_events')
      .select('coverage_id')
      .where('claim_id', '=', claimId)
      .where('kind', 'in', SUBMISSIONS)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst()
  )?.coverage_id ?? null;

export const findBatchClaims = (db: Db, tenantId: string, controlNumber: string) => {
  const number = claimNumberOf(controlNumber);
  return number === null
    ? Promise.resolve([])
    : db
        .selectFrom('claim_batches as b')
        .innerJoin('claim_events as e', 'e.batch_id', 'b.id')
        .innerJoin('claims as c', 'c.id', 'e.claim_id')
        .select(['e.claim_id', 'e.coverage_id', 'c.number'])
        .distinct()
        .where('b.tenant_id', '=', tenantId)
        .where('b.control_number', '=', number)
        .where('e.kind', 'in', SUBMISSIONS)
        .execute();
};

export const insertAcknowledgment = async (
  db: Db,
  a: {
    claimId: string;
    coverageId: string;
    kind: 'accepted' | 'rejected';
    note: string;
    payerClaimNumber: string | null;
    sourceKey: string;
    createdBy: string;
  }
) =>
  (await db
    .insertInto('claim_events')
    .values({
      claim_id: a.claimId,
      kind: a.kind,
      coverage_id: a.coverageId,
      note: a.note,
      payer_claim_number: a.payerClaimNumber,
      created_by: a.createdBy,
      source_key: a.sourceKey
    })
    .onConflict((oc) => oc.columns(['claim_id', 'source_key']).doNothing())
    .returning('id')
    .executeTakeFirst()) !== undefined;

export const findTracedCoverage = (db: Db, tenantId: string, trace: string) =>
  db
    .selectFrom('claim_coverages')
    .select(['id', 'claim_id'])
    .where('tenant_id', '=', tenantId)
    .where(sql<string>`id::text`, '=', trace.toLowerCase())
    .executeTakeFirst();

export const saveEligibility = (
  db: Db,
  coverageId: string,
  e: { active: boolean; note: string; checkedAt: Date }
) =>
  db
    .updateTable('claim_coverages')
    .set({
      eligibility: e.active ? 'active' : 'inactive',
      eligibility_note: e.note || null,
      eligibility_checked_at: e.checkedAt
    })
    .where('id', '=', coverageId)
    .execute();
