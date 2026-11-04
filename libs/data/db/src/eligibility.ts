import { type EligibilityRequest, SELF } from '@ugula/billing';
import { sql } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { payerName } from './claim-responses.ts';
import type { Db } from './schema.ts';

export const NO_CHECKABLE_PAYER =
  'No payer on this claim has a directory payer and member ID to check eligibility with';

export const findEligibilityClaim = (db: Db, agencyId: string, id: string) =>
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
    .where('c.agency_id', '=', agencyId)
    .where('c.id', '=', id)
    .executeTakeFirst();

export type EligibilityClaimRow = NonNullable<Awaited<ReturnType<typeof findEligibilityClaim>>>;

export const eligibilityRequests = (
  row: EligibilityClaimRow,
  today: string
): EligibilityRequest[] =>
  row.coverages.flatMap((c) => {
    if (!c.payer_id || !c.member_id) return [];
    const self = c.relationship === SELF;
    const lastName = self ? row.last_name : c.insured_last_name;
    if (!lastName) return [];
    return [
      {
        trace: c.id,
        payer: { name: c.payer, payerId: c.payer_id },
        subscriber: {
          lastName,
          firstName: self ? row.first_name : c.insured_first_name,
          memberId: c.member_id,
          birthDate: self ? row.birth_date : null,
          sex: self ? row.gender : null
        },
        serviceDate: row.service_date ?? today
      }
    ];
  });
