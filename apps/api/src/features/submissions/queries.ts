import { type Db, payerName } from '@ugula/db';
import { sql } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';

export const findEligibilityClaim = (db: Db, tenantId: string, id: string) =>
  db
    .selectFrom('claims as c')
    .innerJoin('patients as p', 'p.id', 'c.patient_id')
    .select((eb) => [
      'c.number',
      'c.service_date',
      'p.first_name',
      'p.last_name',
      'p.birth_date',
      'p.gender',
      jsonArrayFrom(
        eb
          .selectFrom('claim_coverages as cc')
          .leftJoin('payers as dp', 'dp.id', 'cc.payer_id')
          .select([
            'cc.id',
            payerName.as('payer'),
            'dp.payer_id',
            'cc.member_id',
            sql<string>`cc.relationship`.as('relationship'),
            'cc.insured_first_name',
            'cc.insured_last_name'
          ])
          .whereRef('cc.claim_id', '=', 'c.id')
          .orderBy('cc.position')
      ).as('coverages')
    ])
    .where('c.tenant_id', '=', tenantId)
    .where('c.id', '=', id)
    .executeTakeFirst();

export type EligibilityClaimRow = NonNullable<Awaited<ReturnType<typeof findEligibilityClaim>>>;

export const findBatchDocument = async (db: Db, tenantId: string, id: string) =>
  (await db
    .selectFrom('claim_batches')
    .select(['document', 'control_number'])
    .where('tenant_id', '=', tenantId)
    .where('id', '=', id)
    .executeTakeFirst()) ?? null;
