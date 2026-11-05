import { payerKey } from '@ugula/billing';
import type { Db } from '@ugula/db';
import { sql } from 'kysely';
import type { PayerEntry } from './schemas.ts';

export type PayerOrder = {
  keep: { id: string; position: number }[];
  add: (Omit<PayerEntry, 'name'> & { payer: string; position: number })[];
  remove: string[];
};

export const reorderCoverages = async (
  db: Db,
  agencyId: string,
  claimId: string,
  order: PayerOrder
) => {
  if (order.remove.length) {
    await db
      .deleteFrom('claim_coverages')
      .where('claim_id', '=', claimId)
      .where('id', 'in', order.remove)
      .execute();
  }
  if (order.keep.length) {
    await sql`
      update claim_coverages cc set position = v.position
      from (values ${sql.join(order.keep.map((c) => sql`(${c.id}::uuid, ${c.position}::smallint)`))})
        as v (id, position)
      where cc.id = v.id and cc.claim_id = ${claimId}`.execute(db);
  }
  if (order.add.length) {
    await db
      .insertInto('claim_coverages')
      .values(
        order.add.map((c) => ({
          claim_id: claimId,
          agency_id: agencyId,
          position: c.position,
          payer_name: c.payer,
          relationship: c.relationship,
          insured_first_name: c.insuredFirstName,
          insured_last_name: c.insuredLastName,
          payer_id: db
            .selectFrom('payers')
            .select('id')
            .where('agency_id', '=', agencyId)
            .where((eb) =>
              eb.or([
                eb(sql`lower(name)`, '=', c.payer.toLowerCase()),
                eb(
                  'id',
                  'in',
                  eb
                    .selectFrom('payer_aliases')
                    .select('payer_id')
                    .where('agency_id', '=', agencyId)
                    .where('alias_key', '=', payerKey(c.payer))
                )
              ])
            )
            .orderBy(sql`lower(name) = ${c.payer.toLowerCase()}`, 'desc')
            .limit(1)
        }))
      )
      .execute();
  }
  await db
    .updateTable('claims')
    .set({ updated_at: sql`now()` })
    .where('id', '=', claimId)
    .execute();
};
