import type { ClaimCheck } from '@ugula/billing';
import type { Db } from './schema.ts';

export const findClaimCheck = async (
  db: Db,
  tenantId: string,
  claimId: string
): Promise<ClaimCheck | null> => {
  const claim = await db
    .selectFrom('claims as c')
    .leftJoin('patients as p', 'p.id', 'c.patient_id')
    .select([
      'c.id',
      'c.patient_id',
      'c.pcr_number',
      'c.trip_type',
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
      'p.address_line',
      'p.city',
      'p.state',
      'p.postal_code'
    ])
    .where('c.id', '=', claimId)
    .where('c.tenant_id', '=', tenantId)
    .executeTakeFirst();
  if (!claim) return null;
  const [lines, payers, diagnoses] = await Promise.all([
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
        'cc.member_id',
        'cc.relationship',
        'cc.insured_first_name',
        'cc.insured_last_name'
      ])
      .where('cc.claim_id', '=', claim.id)
      .orderBy('cc.position')
      .execute(),
    db
      .selectFrom('claim_diagnoses')
      .select('code')
      .where('claim_id', '=', claim.id)
      .orderBy('position')
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
    tripType: claim.trip_type,
    level: claim.level,
    emergency: claim.emergency,
    loadedMiles: claim.loaded_miles === null ? null : Number(claim.loaded_miles),
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
      insuredLastName: p.insured_last_name
    })),
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
          : null
    }
  };
};
