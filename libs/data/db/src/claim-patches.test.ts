import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyClaimEdit, type ClaimEdit } from './claim-patches.ts';
import { createRecordingDb } from './testing.ts';

const empty: ClaimEdit = {
  serviceDate: null,
  tripType: null,
  level: null,
  emergency: null,
  loadedMiles: null,
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
    assert.equal(queries.length, 1);
    assert.match(queries[0]?.sql ?? '', /on conflict \("claim_id", "source_key"\) do nothing/);
    assert.deepEqual(queries[0]?.parameters.slice(0, 2), ['c1', 'edited']);
  });

  it('skips an edit already applied for its source key', async () => {
    const { db, queries } = createRecordingDb();
    const edit = { ...empty, serviceDate: '2026-10-01' };
    assert.equal(await applyClaimEdit(db, 't1', 'c1', edit, event), false);
    assert.equal(queries.length, 1);
  });

  it('applies each given field in set-based statements', async () => {
    const { db, queries } = createRecordingDb(logged);
    const edit: ClaimEdit = {
      ...empty,
      serviceDate: '2026-10-01',
      originDestination: 'RH',
      destination: {
        name: 'Mercy',
        addressLine: '1 Main St',
        city: 'Springfield',
        state: 'IL',
        postalCode: '62701'
      },
      patientAddress: { addressLine: '9 Oak', city: 'Springfield', state: 'IL', postalCode: null },
      diagnoses: ['R079'],
      lines: [{ code: 'A0427', units: 1, unitCents: 90_000, totalCents: 90_000 }],
      coverages: [
        {
          coverageId: 'cov1',
          payerId: null,
          memberId: 'M1',
          groupId: null,
          relationship: null,
          insuredFirstName: null,
          insuredLastName: null,
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
      }
    };
    assert.equal(await applyClaimEdit(db, 't1', 'c1', edit, event), true);
    const sqls = queries.map((q) => q.sql);
    const claim = sqls.find((s) => s.startsWith('update "claims"')) ?? '';
    for (const column of ['service_date', 'origin_code', 'destination_name', 'total_cents']) {
      assert.match(claim, new RegExp(`"${column}" = `));
    }
    assert.doesNotMatch(claim, /"level"|"pickup_city"/);
    assert.ok(sqls.some((s) => s.startsWith('update "patients"')));
    const cleared = sqls.findIndex((s) => s.startsWith('delete from "claim_diagnoses"'));
    assert.ok(cleared >= 0 && sqls[cleared + 1]?.startsWith('insert into "claim_diagnoses"'));
    assert.ok(sqls.some((s) => s.startsWith('insert into "claim_lines"')));
    assert.ok(sqls.some((s) => /update claim_coverages cc set\s+payer_id/.test(s)));
    assert.ok(sqls.some((s) => s.startsWith('delete from "claim_coverages"')));
    assert.ok(sqls.some((s) => /row_number\(\) over/.test(s)));
    assert.ok(sqls.some((s) => /insert into "claim_coverages".*select/s.test(s)));
  });
});
