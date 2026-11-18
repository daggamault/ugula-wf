import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ClaimInput } from '@ugula/billing';
import { createRecordingDb } from '@ugula/db/testing';
import { createClaimStore } from './queries.ts';

const CLAIM_ID = '0195f2a4-0000-7000-8000-000000000001';
const ENCOUNTER = '0195f2a4-0000-7000-8000-000000000002';
const PATIENT = '0195f2a4-0000-7000-8000-000000000003';
const PAYER = '0195f2a4-0000-7000-8000-000000000004';

const CLAIM: ClaimInput = {
  encounterId: ENCOUNTER,
  patientId: PATIENT,
  classification: 'emergency',
  serviceDate: '2026-09-14',
  level: 'ALS1',
  emergency: true,
  loadedMiles: 11.6,
  originCode: 'R',
  destinationCode: 'H',
  diagnoses: ['R079'],
  coverages: [
    {
      payerId: PAYER,
      payerName: 'Medicare',
      memberId: 'M1',
      groupId: null,
      relationship: '18',
      insuredFirstName: null,
      insuredLastName: null
    }
  ],
  lines: [{ code: 'A0427', modifiers: ['RH'], units: 1, unitCents: 80000, totalCents: 80000 }],
  totalCents: 80000,
  reasons: ['Emergency response']
};

const tables = (sql: string) =>
  sql
    .match(/^(insert into|delete from) "(\w+)"/)
    ?.slice(1)
    .join(' ');

describe('createClaimStore', () => {
  it('saves the claim for its encounter and replaces its lines, payers and diagnoses', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('insert into "claims"')
        ? [{ id: CLAIM_ID, agency_id: 't-1', inserted: true }]
        : []
    );
    assert.deepEqual(await createClaimStore(db).saveClaim('r1', CLAIM), {
      id: CLAIM_ID,
      outcome: 'created'
    });
    assert.deepEqual(
      queries.map((q) => tables(q.sql)),
      [
        'insert into claims',
        'delete from claim_lines',
        'delete from claim_coverages',
        'delete from claim_diagnoses',
        'insert into claim_lines',
        'insert into claim_coverages',
        'insert into claim_diagnoses'
      ]
    );
    assert.match(
      queries[0]?.sql ?? '',
      /on conflict \("agency_id", "encounter_id"\) do update set/
    );
    assert.deepEqual(queries[4]?.parameters, [CLAIM_ID, 1, 'A0427', ['RH'], 1, 80000, 80000]);
  });

  it('replaces an existing claim and saves no empty lists', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('insert into "claims"')
        ? [{ id: CLAIM_ID, agency_id: 't-1', inserted: false }]
        : []
    );
    const saved = await createClaimStore(db).saveClaim('r1', {
      ...CLAIM,
      lines: [],
      coverages: [],
      diagnoses: [],
      totalCents: 0
    });
    assert.equal(saved.outcome, 'replaced');
    assert.equal(queries.length, 4);
  });

  it('refuses ids that are not ids before touching the database', async () => {
    const { db, queries } = createRecordingDb();
    await assert.rejects(
      createClaimStore(db).saveClaim('r1', { ...CLAIM, patientId: 'p-1' }),
      /Patient p-1 does not exist/
    );
    await assert.rejects(
      createClaimStore(db).saveClaim('r1', { ...CLAIM, encounterId: 'e-1' }),
      /Encounter e-1 does not exist/
    );
    await assert.rejects(
      createClaimStore(db).saveClaim('r1', {
        ...CLAIM,
        coverages: [
          { ...(CLAIM.coverages[0] as ClaimInput['coverages'][number]), payerId: 'pay-1' }
        ]
      }),
      /Payer pay-1 does not exist/
    );
    assert.equal(queries.filter((q) => !/^(begin|commit|rollback)/.test(q.sql)).length, 0);
  });
});
