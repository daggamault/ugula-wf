import {
  type CheckedFacility,
  type ClaimCheck,
  isDocumentKind,
  isFacilityKind,
  type ReportedStay
} from '@ugula/billing';
import { type ExpressionBuilder, sql } from 'kysely';
import { jsonObjectFrom } from 'kysely/helpers/postgres';
import { DOCUMENTATION_COLUMNS, documentationOf } from './claim-documentation.ts';
import type { Database, Db } from './schema.ts';
import { agencyTimeZone } from './time-zones.ts';

type ClaimRow = ExpressionBuilder<Database & { c: Database['claims'] }, 'c'>;

const sameAddress = (line: 'c.pickup_address_line' | 'c.destination_address_line', zip: string) =>
  sql<boolean>`lower(f.address_line) = lower(${sql.ref(line)}) and left(f.postal_code, 5) = left(${sql.ref(zip)}, 5)`;

const facilityAt = (eb: ClaimRow, where: ReturnType<typeof sql<boolean>>) =>
  jsonObjectFrom(
    eb
      .selectFrom('facilities as f')
      .select(['f.id', 'f.name', 'f.kind', 'f.contract'])
      .whereRef('f.agency_id', '=', 'c.agency_id')
      .where(where)
      .orderBy('f.contract', 'desc')
      .orderBy('f.name')
      .limit(1)
  );

const facilityOf = (x: { id: string; name: string; kind: string; contract: boolean } | null) =>
  x && isFacilityKind(x.kind) ? ({ ...x, kind: x.kind } satisfies CheckedFacility) : null;

const stayOf = (p: {
  stay_kind: ReportedStay['kind'] | null;
  stay_admitted_on: string | null;
  stay_discharged_on: string | null;
}): ReportedStay | null =>
  p.stay_kind
    ? { kind: p.stay_kind, admittedOn: p.stay_admitted_on, dischargedOn: p.stay_discharged_on }
    : null;

export const findClaimCheck = async (
  db: Db,
  agencyId: string,
  claimId: string
): Promise<ClaimCheck | null> => {
  const claim = await db
    .selectFrom('claims as c')
    .leftJoin('patients as p', 'p.id', 'c.patient_id')
    .select((eb) => [
      'c.id',
      'c.patient_id',
      'c.pcr_number',
      'c.classification',
      'c.level',
      'c.emergency',
      'c.loaded_miles',
      'c.total_cents',
      'c.service_date',
      'c.origin_code',
      'c.destination_code',
      'c.pickup_address_line',
      'c.pickup_city',
      'c.pickup_state',
      'c.pickup_postal_code',
      'c.destination_name',
      'c.destination_address_line',
      'c.destination_city',
      'c.destination_state',
      'c.destination_postal_code',
      ...DOCUMENTATION_COLUMNS,
      'c.deceased',
      'c.non_covered_miles',
      'c.facility_id',
      agencyTimeZone(sql.ref('c.agency_id')).as('time_zone'),
      eb
        .exists(
          eb
            .selectFrom('claim_events as re')
            .select('re.id')
            .whereRef('re.claim_id', '=', 'c.id')
            .where('re.kind', '=', 'responsibility')
        )
        .as('responsibility_recorded'),
      'p.address_line',
      'p.city',
      'p.state',
      'p.postal_code',
      facilityAt(eb, sameAddress('c.pickup_address_line', 'c.pickup_postal_code')).as(
        'pickup_facility'
      ),
      facilityAt(
        eb,
        sql<boolean>`(lower(f.name) = lower(c.destination_name) or ${sameAddress('c.destination_address_line', 'c.destination_postal_code')})`
      ).as('destination_facility')
    ])
    .where('c.id', '=', claimId)
    .where('c.agency_id', '=', agencyId)
    .executeTakeFirst();
  if (!claim) return null;
  const [lines, payers, diagnoses, documents] = await Promise.all([
    db
      .selectFrom('claim_lines')
      .select(['code', 'units', 'unit_cents', 'total_cents'])
      .where('claim_id', '=', claim.id)
      .orderBy('position')
      .execute(),
    db
      .selectFrom('claim_coverages as cc')
      .leftJoin('payers as dp', 'dp.id', 'cc.payer_id')
      .select([
        'cc.id',
        'cc.payer_name',
        'cc.payer_id',
        'dp.claim_filing',
        'dp.filing_limit_days',
        'cc.eligibility',
        'cc.eligibility_note',
        'cc.member_id',
        'cc.relationship',
        'cc.insured_first_name',
        'cc.insured_last_name',
        'cc.stay_kind',
        'cc.stay_admitted_on',
        'cc.stay_discharged_on'
      ])
      .where('cc.claim_id', '=', claim.id)
      .orderBy('cc.position')
      .execute(),
    db
      .selectFrom('claim_diagnoses')
      .select('code')
      .where('claim_id', '=', claim.id)
      .orderBy('position')
      .execute(),
    db
      .selectFrom('claim_documents')
      .select('kind')
      .distinct()
      .where('claim_id', '=', claim.id)
      .orderBy('kind')
      .execute()
  ]);
  return {
    patientId: claim.patient_id,
    patient: claim.patient_id
      ? {
          addressLine: claim.address_line,
          city: claim.city,
          state: claim.state,
          postalCode: claim.postal_code
        }
      : null,
    pcrNumber: claim.pcr_number,
    classification: claim.classification,
    level: claim.level,
    emergency: claim.emergency,
    loadedMiles: claim.loaded_miles === null ? null : Number(claim.loaded_miles),
    deceased: claim.deceased,
    nonCoveredMiles: claim.non_covered_miles === null ? null : Number(claim.non_covered_miles),
    lines: lines.map((l) => ({
      code: l.code,
      units: Number(l.units),
      unitCents: l.unit_cents,
      totalCents: l.total_cents
    })),
    totalCents: claim.total_cents,
    payers: payers.map((p) => ({
      coverageId: p.id,
      name: p.payer_name,
      payerId: p.payer_id,
      claimFiling: p.claim_filing,
      memberId: p.member_id,
      relationship: p.relationship,
      insuredFirstName: p.insured_first_name,
      insuredLastName: p.insured_last_name,
      filingLimitDays: p.filing_limit_days,
      eligibility: p.eligibility,
      eligibilityNote: p.eligibility_note,
      stay: stayOf(p)
    })),
    pickupFacility: facilityOf(claim.pickup_facility ?? null),
    destinationFacility: facilityOf(claim.destination_facility ?? null),
    responsibleParty: claim.facility_id ? 'facility' : 'payer',
    responsibilityRecorded: claim.facility_id !== null || claim.responsibility_recorded === true,
    documents: documents.map((d) => d.kind).filter(isDocumentKind),
    timeZone: claim.time_zone,
    details: {
      serviceDate: claim.service_date,
      pickup: {
        name: null,
        addressLine: claim.pickup_address_line,
        city: claim.pickup_city,
        state: claim.pickup_state,
        postalCode: claim.pickup_postal_code
      },
      destination: {
        name: claim.destination_name,
        addressLine: claim.destination_address_line,
        city: claim.destination_city,
        state: claim.destination_state,
        postalCode: claim.destination_postal_code
      },
      diagnoses: diagnoses.map((d) => d.code),
      originDestination:
        claim.origin_code && claim.destination_code
          ? claim.origin_code + claim.destination_code
          : null,
      documentation: documentationOf(claim)
    }
  };
};
