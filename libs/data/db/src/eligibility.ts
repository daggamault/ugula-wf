import { type EligibilityRequest, localDate, SELF } from '@ugula/billing';
import { sql } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { payerName } from './claim-responses.ts';
import type { Db } from './schema.ts';
import { agencyTimeZone } from './time-zones.ts';

export const NO_CHECKABLE_PAYER =
  'No payer on this claim has a directory payer and member ID to check eligibility with';

export const NOTHING_TO_ASK =
  'Every payer on this claim already has an eligibility answer or a request waiting for one';

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
      agencyTimeZone(sql.ref('c.agency_id')).as('time_zone'),
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
            'cc.insured_last_name',
            sql<boolean>`cc.eligibility is not null or cc.eligibility_requested_at is not null`.as(
              'asked'
            )
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
  at: Date,
  { force = true }: { force?: boolean } = {}
): EligibilityRequest[] =>
  row.coverages.flatMap((c) => {
    if (!c.payer_id || !c.member_id || (!force && c.asked)) return [];
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
        serviceDate: row.service_date ?? localDate(at, row.time_zone)
      }
    ];
  });

export const reuseEligibility = (db: Db, agencyId: string, claimId: string) =>
  sql<{ id: string }>`
    update claim_coverages cc set
      eligibility = prior.eligibility,
      eligibility_note = concat_ws('; ', 'From claim ' || prior.number, prior.eligibility_note),
      eligibility_checked_at = prior.eligibility_checked_at
    from claims c, lateral (
      select o.eligibility, o.eligibility_note, o.eligibility_checked_at, oc.number
      from claim_coverages o
      join claims oc on oc.id = o.claim_id and oc.agency_id = o.agency_id
      where o.agency_id = c.agency_id
        and o.claim_id <> c.id
        and oc.patient_id = c.patient_id
        and o.payer_id = cc.payer_id
        and lower(o.member_id) = lower(cc.member_id)
        and o.relationship = cc.relationship
        and o.eligibility is not null
        and date_trunc('month', oc.service_date) = date_trunc('month', c.service_date)
      order by o.eligibility_checked_at desc
      limit 1
    ) prior
    where cc.claim_id = c.id
      and c.agency_id = ${agencyId}
      and c.id = ${claimId}
      and cc.payer_id is not null
      and cc.member_id is not null
      and cc.eligibility is null
      and cc.eligibility_requested_at is null
    returning cc.id`.execute(db);

export const markEligibilityRequested = (
  db: Db,
  agencyId: string,
  coverageIds: string[],
  at: Date
) =>
  coverageIds.length
    ? db
        .updateTable('claim_coverages')
        .set({ eligibility_requested_at: at })
        .where('agency_id', '=', agencyId)
        .where('id', 'in', coverageIds)
        .execute()
    : Promise.resolve([]);
