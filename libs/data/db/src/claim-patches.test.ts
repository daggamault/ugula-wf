import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyClaimEdit, type ClaimEdit } from './claim-patches.ts';
import { createRecordingDb } from './testing.ts';

const empty: ClaimEdit = {
  serviceDate: null,
  classification: null,
  level: null,
  emergency: null,
  loadedMiles: null,
  deceased: null,
  nonCoveredMiles: null,
  diagnoses: null,
  pickup: null,
  destination: null,
  originDestination: null,
  documentation: null,
  patientAddress: null,
  coverages: [],
  newCoverage: null,
  lines: null,
  note: null
};

const event = { sourceKey: 'run:1', createdBy: null };

const logged = ({ sql }: { sql: string }) =>
  sql.includes('insert into "claim_events"') ? [{ id: 'e1' }] : [];

describe('applyClaimEdit', () => {
  it('logs the edit and changes nothing else when no field is given', async () => {
    const { db, queries } = createRecordingDb(logged);
    assert.equal(await applyClaimEdit(db, 't1', 'c1', empty, event), true);
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [
          'insert into "claim_events" ("agency_id", "claim_id", "kind", "note", "created_by_id", "source_key") values ($1, $2, $3, $4, $5, $6) on conflict ("claim_id", "source_key") do nothing returning "id"',
          ['t1', 'c1', 'edited', 'Claim data edited', null, 'run:1']
        ]
      ]
    );
  });

  it('skips an edit already applied for its source key', async () => {
    const { db, queries } = createRecordingDb();
    const edit = { ...empty, serviceDate: '2026-10-01' };
    assert.equal(await applyClaimEdit(db, 't1', 'c1', edit, event), false);
    assert.equal(queries.length, 1);
  });

  it('applies each given field in set-based statements, keeping eligibility only for the same insured', async () => {
    const { db, queries } = createRecordingDb(logged);
    const edit: ClaimEdit = {
      ...empty,
      serviceDate: '2026-10-01',
      nonCoveredMiles: 2.5,
      originDestination: 'RH',
      pickup: {
        name: null,
        addressLine: '9 Oak Ave',
        city: 'Springfield',
        state: 'IL',
        postalCode: '62702'
      },
      destination: {
        name: 'Mercy',
        addressLine: '1 Main St',
        city: 'Springfield',
        state: 'IL',
        postalCode: '62701'
      },
      patientAddress: { addressLine: '9 Oak', city: 'Springfield', state: 'IL', postalCode: null },
      diagnoses: ['R079', 'R51'],
      lines: [{ code: 'A0427', units: 1, unitCents: 90_000, totalCents: 90_000 }],
      coverages: [
        {
          coverageId: 'cov1',
          payerId: 'p9',
          memberId: 'M1',
          groupId: 'G1',
          relationship: '01',
          insuredFirstName: 'Ann',
          insuredLastName: 'Doe',
          remove: false
        },
        {
          coverageId: 'cov2',
          payerId: null,
          memberId: null,
          groupId: null,
          relationship: null,
          insuredFirstName: null,
          insuredLastName: null,
          remove: true
        }
      ],
      newCoverage: {
        payerId: 'p1',
        memberId: 'M2',
        relationship: '18',
        insuredFirstName: null,
        insuredLastName: null
      },
      note: 'Fixed the PCR'
    };
    assert.equal(
      await applyClaimEdit(db, 't1', 'c1', edit, { sourceKey: 'run:1', createdBy: 'u1' }),
      true
    );
    const sameInsured = (agency: string, column: string) =>
      `case when coalesce((select p.id from payers p where p.id = v.payer_id and p.agency_id = ${agency}), cc.payer_id) is not distinct from cc.payer_id and lower(coalesce(v.member_id, cc.member_id, '')) = lower(coalesce(cc.member_id, '')) then "cc"."${column}" end`;
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [
          'insert into "claim_events" ("agency_id", "claim_id", "kind", "note", "created_by_id", "source_key") values ($1, $2, $3, $4, $5, $6) on conflict ("claim_id", "source_key") do nothing returning "id"',
          ['t1', 'c1', 'edited', 'Fixed the PCR', 'u1', 'run:1']
        ],
        [
          'update "claims" set "service_date" = $1, "non_covered_miles" = $2, "origin_code" = $3, "destination_code" = $4, "pickup_address_line" = $5, "pickup_city" = $6, "pickup_state" = $7, "pickup_postal_code" = $8, "destination_address_line" = $9, "destination_city" = $10, "destination_state" = $11, "destination_postal_code" = $12, "destination_name" = $13, "total_cents" = $14, "updated_at" = now() where "id" = $15',
          [
            '2026-10-01',
            2.5,
            'R',
            'H',
            '9 Oak Ave',
            'Springfield',
            'IL',
            '62702',
            '1 Main St',
            'Springfield',
            'IL',
            '62701',
            'Mercy',
            90_000,
            'c1'
          ]
        ],
        [
          'update "patients" set "address_line" = $1, "city" = $2, "state" = $3, "postal_code" = $4, "updated_at" = now() where "agency_id" = $5 and "id" = (select "patient_id" from "claims" where "id" = $6)',
          ['9 Oak', 'Springfield', 'IL', null, 't1', 'c1']
        ],
        ['delete from "claim_diagnoses" where "claim_id" = $1', ['c1']],
        [
          'insert into "claim_diagnoses" ("claim_id", "position", "code") values ($1, $2, $3), ($4, $5, $6)',
          ['c1', 1, 'R079', 'c1', 2, 'R51']
        ],
        ['delete from "claim_lines" where "claim_id" = $1', ['c1']],
        [
          'insert into "claim_lines" ("claim_id", "position", "code", "units", "unit_cents", "total_cents") values ($1, $2, $3, $4, $5, $6)',
          ['c1', 1, 'A0427', 1, 90_000, 90_000]
        ],
        [
          [
            '',
            '    update claim_coverages cc set',
            '      payer_id = coalesce((select p.id from payers p where p.id = v.payer_id and p.agency_id = $1), cc.payer_id),',
            '      member_id = coalesce(v.member_id, cc.member_id),',
            `      eligibility = ${sameInsured('$2', 'eligibility')},`,
            `      eligibility_note = ${sameInsured('$3', 'eligibility_note')},`,
            `      eligibility_checked_at = ${sameInsured('$4', 'eligibility_checked_at')},`,
            `      eligibility_requested_at = ${sameInsured('$5', 'eligibility_requested_at')},`,
            '      group_id = coalesce(v.group_id, cc.group_id),',
            '      relationship = coalesce(v.relationship, cc.relationship),',
            '      insured_first_name = coalesce(v.insured_first_name, cc.insured_first_name),',
            '      insured_last_name = coalesce(v.insured_last_name, cc.insured_last_name)',
            '    from (values ($6::uuid, $7::uuid, $8::text, $9::text, $10::text, $11::text, $12::text)) as v (id, payer_id, member_id, group_id, relationship, insured_first_name, insured_last_name)',
            '    where cc.id = v.id and cc.claim_id = $13'
          ].join('\n'),
          ['t1', 't1', 't1', 't1', 't1', 'cov1', 'p9', 'M1', 'G1', '01', 'Ann', 'Doe', 'c1']
        ],
        ['delete from "claim_coverages" where "claim_id" = $1 and "id" in ($2)', ['c1', 'cov2']],
        [
          [
            '',
            '    update claim_coverages cc set position = r.position',
            '    from (',
            '      select id, row_number() over (order by position) as position',
            '      from claim_coverages where claim_id = $1',
            '    ) r',
            '    where cc.id = r.id and cc.position <> r.position'
          ].join('\n'),
          ['c1']
        ],
        [
          'insert into "claim_coverages" ("agency_id", "claim_id", "position", "payer_name", "payer_id", "member_id", "relationship", "insured_first_name", "insured_last_name") select "p"."agency_id", $1::uuid as "claim_id", (select coalesce(max(position), 0) + 1 as "position" from "claim_coverages" where "claim_id" = $2) as "position", "p"."name", "p"."id", $3::text as "member_id", $4::text as "relationship", $5::text as "insured_first_name", $6::text as "insured_last_name" from "payers" as "p" where "p"."id" = $7 and "p"."agency_id" = $8',
          ['c1', 'c1', 'M2', '18', null, null, 'p1', 't1']
        ]
      ]
    );
  });

  it('leaves the diagnoses alone when none are sent', async () => {
    const { db, queries } = createRecordingDb(logged);
    await applyClaimEdit(db, 't1', 'c1', { ...empty, diagnoses: [] }, event);
    assert.equal(queries.length, 1);
  });

  it('splits origin and destination codes, totals the lines and notes a biller signature', async () => {
    const { db, queries } = createRecordingDb(logged);
    const edit: ClaimEdit = {
      ...empty,
      originDestination: 'RH',
      documentation: { signature: 'signed' },
      lines: [
        { code: 'A0427', units: 1, unitCents: 90_000, totalCents: 90_000 },
        { code: 'A0425', units: 7, unitCents: 1_000, totalCents: 7_000 }
      ]
    };
    assert.equal(await applyClaimEdit(db, 't1', 'c1', edit, event), true);
    const claim = queries.find((q) => q.sql.startsWith('update "claims"'));
    assert.equal(
      claim?.sql,
      'update "claims" set "origin_code" = $1, "destination_code" = $2, "signature" = $3, "signature_note" = $4, "total_cents" = $5, "updated_at" = now() where "id" = $6'
    );
    assert.deepEqual(claim?.parameters, ['R', 'H', 'signed', 'Updated by a biller', 97_000, 'c1']);
  });

  it('writes the MSP answers, ABN, QL and A0888 miles a biller changed', async () => {
    const { db, queries } = createRecordingDb(logged);
    const documentation = {
      patientCount: 2,
      abnOnFile: true,
      mspEmployerPlan: false,
      mspAccident: 'workersComp' as const,
      roundTrips: undefined,
      facilityStay: 'snf' as const
    };
    await applyClaimEdit(
      db,
      't1',
      'c1',
      { ...empty, deceased: true, nonCoveredMiles: 0, documentation },
      event
    );
    const claim = queries.find((q) => q.sql.startsWith('update "claims"'));
    assert.equal(
      claim?.sql,
      'update "claims" set "is_deceased" = $1, "non_covered_miles" = $2, "patient_count" = $3, "has_abn" = $4, "has_msp_employer_plan" = $5, "msp_accident" = $6, "facility_stay" = $7, "updated_at" = now() where "id" = $8'
    );
    assert.deepEqual(claim?.parameters, [true, null, 2, true, false, 'workersComp', 'snf', 'c1']);
  });

  it('clears documentation a biller emptied and leaves what they did not send', async () => {
    const { db, queries } = createRecordingDb(logged);
    await applyClaimEdit(
      db,
      't1',
      'c1',
      {
        ...empty,
        documentation: { roundTrips: null, pcsSignedOn: null, priorAuthorization: 'UTN-1' }
      },
      event
    );
    const claim = queries.find((q) => q.sql.startsWith('update "claims"'));
    assert.equal(
      claim?.sql,
      'update "claims" set "pcs_signed_on" = $1, "prior_authorization" = $2, "round_trips" = $3, "updated_at" = now() where "id" = $4'
    );
    assert.deepEqual(claim?.parameters, [null, 'UTN-1', null, 'c1']);
  });

  it('clears every line and zeroes the total when the lines are emptied', async () => {
    const { db, queries } = createRecordingDb(logged);
    await applyClaimEdit(db, 't1', 'c1', { ...empty, lines: [] }, event);
    assert.deepEqual(
      queries.slice(1).map((q) => [q.sql, q.parameters]),
      [
        ['update "claims" set "total_cents" = $1, "updated_at" = now() where "id" = $2', [0, 'c1']],
        ['delete from "claim_lines" where "claim_id" = $1', ['c1']]
      ]
    );
  });
});
