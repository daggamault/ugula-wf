import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findClaimCheck } from './claim-checks.ts';
import { createRecordingDb } from './testing.ts';

const claim = {
  id: 'c1',
  patient_id: 'p1',
  pcr_number: 'PCR-1',
  classification: 'emergency',
  level: 'ALS1',
  is_emergency: true,
  loaded_miles: '7.3',
  total_cents: 100_000,
  service_date: '2026-10-01',
  origin_code: 'R',
  destination_code: 'H',
  pickup_address_line: '9 Oak Ave',
  pickup_city: 'Springfield',
  pickup_state: 'IL',
  pickup_postal_code: '62702',
  destination_name: 'Mercy',
  destination_address_line: null,
  destination_city: null,
  destination_state: null,
  destination_postal_code: null,
  is_deceased: false,
  non_covered_miles: null,
  facility_id: null,
  responsibility_recorded: false,
  pickup_facility: null,
  destination_facility: { id: 'f1', name: 'Mercy', kind: 'hospital', contract: true },
  pickup_zip_split: true,
  pickup_zip_state: 'IL',
  destination_zip_state: null,
  patient_zip_state: 'IL',
  address_line: '1 Main St',
  city: 'Springfield',
  state: 'IL',
  postal_code: '62701',
  time_zone: 'America/Chicago'
};

describe('findClaimCheck', () => {
  it('reads a claim with its patient address, lines, directory-linked payers and diagnoses', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('from "claims"')
        ? [claim]
        : q.sql.includes('from "claim_lines"')
          ? [{ code: 'A0427', units: '1.0', unit_cents: 100_000, total_cents: 100_000 }]
          : q.sql.includes('from "claim_coverages"')
            ? [
                {
                  id: 'cov-1',
                  payer_name: 'Medicare',
                  payer_id: 'p-mcr',
                  claim_filing: 'MB',
                  filing_limit_days: 365,
                  eligibility: 'active',
                  eligibility_note: null,
                  member_id: 'M1',
                  relationship: '18',
                  insured_first_name: null,
                  insured_last_name: null,
                  stay_kind: 'snf',
                  stay_admitted_on: '2026-09-20',
                  stay_discharged_on: null
                }
              ]
            : q.sql.includes('from "claim_documents"')
              ? [{ kind: 'pcs' }, { kind: 'scan' }]
              : [
                  { code: 'R079', description: 'Chest pain, unspecified', is_billable: true },
                  { code: 'R07', description: 'Pain in throat and chest', is_billable: false }
                ]
    );
    const check = await findClaimCheck(db, 't1', 'c1');
    assert.deepEqual(check && { ...check, details: { ...check.details, documentation: null } }, {
      patientId: 'p1',
      patient: {
        addressLine: '1 Main St',
        city: 'Springfield',
        state: 'IL',
        postalCode: '62701'
      },
      pcrNumber: 'PCR-1',
      classification: 'emergency',
      level: 'ALS1',
      emergency: true,
      loadedMiles: 7.3,
      deceased: false,
      nonCoveredMiles: null,
      lines: [{ code: 'A0427', units: 1, unitCents: 100_000, totalCents: 100_000 }],
      totalCents: 100_000,
      payers: [
        {
          coverageId: 'cov-1',
          name: 'Medicare',
          payerId: 'p-mcr',
          claimFiling: 'MB',
          memberId: 'M1',
          relationship: '18',
          insuredFirstName: null,
          insuredLastName: null,
          filingLimitDays: 365,
          eligibility: 'active',
          eligibilityNote: null,
          stay: { kind: 'snf', admittedOn: '2026-09-20', dischargedOn: null }
        }
      ],
      pickupFacility: null,
      destinationFacility: { id: 'f1', name: 'Mercy', kind: 'hospital', contract: true },
      responsibleParty: 'payer',
      responsibilityRecorded: false,
      pickupLocality: { needsPlusFour: true },
      zipStates: { pickup: 'IL', destination: null, patient: 'IL' },
      diagnosisCodes: [
        { code: 'R079', description: 'Chest pain, unspecified', billable: true },
        { code: 'R07', description: 'Pain in throat and chest', billable: false }
      ],
      documents: ['pcs'],
      timeZone: 'America/Chicago',
      details: {
        serviceDate: '2026-10-01',
        pickup: {
          name: null,
          addressLine: '9 Oak Ave',
          city: 'Springfield',
          state: 'IL',
          postalCode: '62702'
        },
        destination: {
          name: 'Mercy',
          addressLine: null,
          city: null,
          state: null,
          postalCode: null
        },
        diagnoses: ['R079', 'R07'],
        originDestination: 'RH',
        documentation: null
      }
    });
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [
          'select "c"."id", "c"."patient_id", "c"."pcr_number", "c"."classification", "c"."level", "c"."is_emergency", "c"."loaded_miles", "c"."total_cents", "c"."service_date", "c"."origin_code", "c"."destination_code", "c"."pickup_address_line", "c"."pickup_city", "c"."pickup_state", "c"."pickup_postal_code", "c"."destination_name", "c"."destination_address_line", "c"."destination_city", "c"."destination_state", "c"."destination_postal_code", "c"."signature", "c"."signature_note", "c"."has_pcs", "c"."pcs_signed_on", "c"."transport_reason", "c"."condition_codes", "c"."prior_authorization", "c"."weight_kg", "c"."at_scene_at", "c"."left_scene_at", "c"."at_destination_at", "c"."patient_count", "c"."closest_facility_miles", "c"."has_abn", "c"."abn_signed_on", "c"."is_denial_expected", "c"."has_msp_employer_plan", "c"."has_msp_esrd", "c"."has_msp_disability", "c"."msp_employer_size", "c"."msp_accident", "c"."prior_authorization_expires_on", "c"."pcs_type", "c"."round_trips", "c"."admitted_on", "c"."facility_stay", "c"."is_deceased", "c"."non_covered_miles", "c"."facility_id", coalesce((select bp.time_zone from billing_profiles bp where bp.agency_id = "c"."agency_id"), \'UTC\') as "time_zone", exists (select "re"."id" from "claim_events" as "re" where "re"."claim_id" = "c"."id" and "re"."kind" = $1) as "responsibility_recorded", "p"."address_line", "p"."city", "p"."state", "p"."postal_code", (select to_json(obj) from (select "f"."id", "f"."name", "f"."kind", "f"."has_contract" as "contract" from "facilities" as "f" where "f"."agency_id" = "c"."agency_id" and lower(f.address_line) = lower("c"."pickup_address_line") and left(f.postal_code, 5) = left("c"."pickup_postal_code", 5) order by "f"."has_contract" desc, "f"."name" limit $2) as obj) as "pickup_facility", (select to_json(obj) from (select "f"."id", "f"."name", "f"."kind", "f"."has_contract" as "contract" from "facilities" as "f" where "f"."agency_id" = "c"."agency_id" and (lower(f.name) = lower(c.destination_name) or lower(f.address_line) = lower("c"."destination_address_line") and left(f.postal_code, 5) = left("c"."destination_postal_code", 5)) order by "f"."has_contract" desc, "f"."name" limit $3) as obj) as "destination_facility", (select "z"."needs_plus_four" from "cms_zip_localities" as "z" where "z"."postal_code" = left("c"."pickup_postal_code", 5)) as "pickup_zip_split", (select "g"."state" from "geonames_postal_codes" as "g" where "g"."postal_code" = left("c"."pickup_postal_code", 5)) as "pickup_zip_state", (select "g"."state" from "geonames_postal_codes" as "g" where "g"."postal_code" = left("c"."destination_postal_code", 5)) as "destination_zip_state", (select "g"."state" from "geonames_postal_codes" as "g" where "g"."postal_code" = left("p"."postal_code", 5)) as "patient_zip_state" from "claims" as "c" left join "patients" as "p" on "p"."id" = "c"."patient_id" where "c"."id" = $4 and "c"."agency_id" = $5',
          ['responsibility', 1, 1, 'c1', 't1']
        ],
        [
          'select "code", "units", "unit_cents", "total_cents" from "claim_lines" where "claim_id" = $1 order by "position"',
          ['c1']
        ],
        [
          'select "cc"."id", "cc"."payer_name", "cc"."payer_id", "dp"."claim_filing", "dp"."filing_limit_days", "cc"."eligibility", "cc"."eligibility_note", "cc"."member_id", "cc"."relationship", "cc"."insured_first_name", "cc"."insured_last_name", "cc"."stay_kind", "cc"."stay_admitted_on", "cc"."stay_discharged_on" from "claim_coverages" as "cc" left join "payers" as "dp" on "dp"."id" = "cc"."payer_id" where "cc"."claim_id" = $1 order by "cc"."position"',
          ['c1']
        ],
        [
          'select "d"."code", "cd"."description", "cd"."is_billable" from "claim_diagnoses" as "d" left join "codes" as "cd" on "cd"."code_set" = $1 and "cd"."code" = "d"."code" where "d"."claim_id" = $2 order by "d"."position"',
          ['icd10cm', 'c1']
        ],
        [
          'select distinct "kind" from "claim_documents" where "claim_id" = $1 order by "kind"',
          ['c1']
        ]
      ]
    );
  });

  it('bills the facility on contract, reads non-covered miles and drops unknown facility kinds', async () => {
    const { db } = createRecordingDb((q) =>
      q.sql.includes('from "claims"')
        ? [
            {
              ...claim,
              non_covered_miles: '2.5',
              facility_id: 'f1',
              responsibility_recorded: null,
              pickup_facility: { id: 'f2', name: 'Lot', kind: 'parking', contract: false },
              destination_facility: undefined,
              pickup_zip_split: null
            }
          ]
        : q.sql.includes('from "claim_coverages"')
          ? [
              {
                id: 'cov-1',
                payer_name: 'Aetna',
                stay_kind: null,
                stay_admitted_on: '2026-09-20',
                stay_discharged_on: null
              }
            ]
          : []
    );
    const check = await findClaimCheck(db, 't1', 'c1');
    assert.deepEqual(
      [
        check?.nonCoveredMiles,
        check?.responsibleParty,
        check?.responsibilityRecorded,
        check?.pickupFacility,
        check?.destinationFacility,
        check?.pickupLocality,
        check?.payers[0]?.stay
      ],
      [2.5, 'facility', true, null, null, null, null]
    );
  });

  it('records responsibility only when a payer was chosen on purpose', async () => {
    const read = async (recorded: boolean | null) => {
      const { db } = createRecordingDb((q) =>
        q.sql.includes('from "claims"') ? [{ ...claim, responsibility_recorded: recorded }] : []
      );
      return (await findClaimCheck(db, 't1', 'c1'))?.responsibilityRecorded;
    };
    assert.deepEqual([await read(true), await read(false), await read(null)], [true, false, false]);
  });

  it('finds nothing for another agency, and no patient address before the patient is known', async () => {
    const missing = createRecordingDb();
    assert.equal(await findClaimCheck(missing.db, 't1', 'c1'), null);
    assert.equal(missing.queries.length, 1);
    const { db } = createRecordingDb((q) =>
      q.sql.includes('from "claims"')
        ? [{ ...claim, patient_id: null, loaded_miles: null, destination_code: null }]
        : []
    );
    const check = await findClaimCheck(db, 't1', 'c1');
    assert.deepEqual(
      [check?.patient, check?.loadedMiles, check?.payers, check?.details.originDestination],
      [null, null, [], null]
    );
  });
});
