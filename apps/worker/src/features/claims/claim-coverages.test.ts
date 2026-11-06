import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NewClaim } from '@ugula/billing';
import { COMPLETE_DOCUMENTATION } from '@ugula/billing/testing';
import { createRecordingDb } from '@ugula/db/testing';
import type { CompiledQuery } from 'kysely';
import { planCoverages, replaceClaimRows } from './claim-coverages.ts';

const ID = '0195f2a4-0000-7000-8000-000000000001';

const place = { addressLine: null, city: null, state: null, postalCode: null };

const claim: NewClaim = {
  patientId: 'p1',
  pcrNumber: 'PCR-1',
  classification: 'emergency',
  level: 'ALS1',
  emergency: true,
  loadedMiles: 12.4,
  deceased: false,
  nonCoveredMiles: null,
  lines: [
    { code: 'A0427', units: 1, unitCents: 95_000, totalCents: 95_000 },
    { code: 'A0425', units: 12.4, unitCents: 1_550, totalCents: 19_220 }
  ],
  totalCents: 114_220,
  coverages: [
    {
      payer: 'Medicare',
      payerId: null,
      payerCode: 'MCR',
      memberId: 'M1',
      groupId: null,
      relationship: '18',
      insuredFirstName: null,
      insuredLastName: null
    },
    {
      payer: 'BCBS',
      payerId: '0195f2a4-0000-7000-8000-00000000000b',
      payerCode: null,
      memberId: null,
      groupId: 'G9',
      relationship: '18',
      insuredFirstName: null,
      insuredLastName: null
    }
  ],
  details: {
    serviceDate: '2026-10-01',
    pickup: { name: null, ...place, state: 'IL' },
    destination: { name: 'St. Mary', ...place },
    diagnoses: ['R079', 'I10'],
    originDestination: 'SH',
    documentation: COMPLETE_DOCUMENTATION
  },
  reportKey: 'imports/t-1/a/f.xml.reports/00000.json'
};

const sqlOf = (queries: readonly CompiledQuery[], prefix: string) =>
  queries.filter((q) => q.sql.startsWith(prefix));

describe('claim coverages', () => {
  it('drops repeated payers by name and member ID, and repeated diagnosis codes', async () => {
    const { db, queries } = createRecordingDb();
    const [medicare] = claim.coverages;
    assert.ok(medicare);
    await replaceClaimRows(db, 'r1', ID, {
      ...claim,
      lines: [],
      coverages: [
        medicare,
        { ...medicare, payer: 'MEDICARE', memberId: 'm1', payerCode: 'DUP' },
        { ...medicare, memberId: 'M2' }
      ],
      details: { ...claim.details, diagnoses: ['R079', 'I10', 'R079'] }
    });
    assert.equal(sqlOf(queries, 'insert into "claim_lines"').length, 0);
    const [coverages] = sqlOf(queries, 'insert into "claim_coverages"');
    assert.ok(coverages?.parameters.includes('M1') && coverages.parameters.includes('M2'));
    assert.ok(!coverages?.parameters.includes('DUP'));
    const [diagnoses] = sqlOf(queries, 'insert into "claim_diagnoses"');
    assert.deepEqual(diagnoses?.parameters, [ID, 1, 'R079', ID, 2, 'I10']);
  });

  it('keeps payers with billing activity by name and member ID, then by name, and moves the rest last', () => {
    const [medicare, bcbs] = claim.coverages;
    assert.ok(medicare && bcbs);
    const active = [
      { id: 'a', payer_name: 'BCBS', member_id: null },
      { id: 'b', payer_name: 'MEDICARE', member_id: 'old' },
      { id: 'c', payer_name: 'Medicare', member_id: 'm1' },
      { id: 'd', payer_name: 'Aetna', member_id: 'X' }
    ];
    assert.deepEqual(
      planCoverages(active, [
        medicare,
        { ...medicare, memberId: 'M2' },
        { ...bcbs, payer: 'Cigna' }
      ]),
      {
        rows: [
          { coverage: medicare, position: 1, id: 'c' },
          { coverage: { ...medicare, memberId: 'M2' }, position: 2, id: 'b' },
          { coverage: { ...bcbs, payer: 'Cigna' }, position: 3, id: null }
        ],
        trailing: [
          { id: 'a', position: 4 },
          { id: 'd', position: 5 }
        ]
      }
    );
  });

  it('reworks the rows without deleting payers that have billing activity', async () => {
    const KEPT = '0195f2a4-0000-7000-8000-0000000000e1';
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('with "lines"')
        ? [{ id: KEPT, payer_name: 'Medicare', member_id: 'M0' }]
        : []
    );
    await replaceClaimRows(db, 'r1', ID, claim);
    const [cleared] = sqlOf(queries, 'with "lines" as (delete from "claim_lines"');
    assert.ok(
      cleared?.sql.includes(
        '"coverages" as (delete from "claim_coverages" where "claim_id" = $2 and not exists (select "e"."id" from "claim_events" as "e" where "e"."coverage_id" = "claim_coverages"."id"))'
      )
    );
    const [kept] = sqlOf(
      queries,
      '\n    update claim_coverages cc set\n      position = v.position'
    );
    assert.ok(
      kept?.sql.includes('eligibility = case when cc.payer_id is not distinct from v.payer_id')
    );
    assert.deepEqual(kept?.parameters.slice(0, 3), [KEPT, 1, 'Medicare']);
    assert.ok(kept?.parameters.includes('M1'));
    const [added] = sqlOf(queries, 'insert into "claim_coverages"');
    assert.ok(added?.parameters.includes('0195f2a4-0000-7000-8000-00000000000b'));
    assert.ok(!added?.parameters.includes('MCR'));
  });
});
