import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import type { RunQueueClient } from '@ugula/run-queue';
import type { CompiledQuery } from 'kysely';
import { recordAnnouncements } from '../../shared/testing.ts';
import type { ClaimEdit } from './schemas.ts';
import { createClaimService } from './service.ts';

const boss: RunQueueClient = { insert: async () => undefined };

const deps = (db: ReturnType<typeof createRecordingDb>['db']) => ({
  db,
  boss,
  publish: recordAnnouncements().publish
});

const claim = {
  id: 'c1',
  status: 'needs_review',
  patient_id: 'p1',
  total_cents: 100_000,
  coverages: [{ id: 'cov-1', payer: 'Medicare' }],
  lines: [{ code: 'A0427' }],
  diagnoses: ['I214']
};

const setup = (row: Record<string, unknown> | null = claim) => {
  const { db, queries } = createRecordingDb((q: CompiledQuery) => {
    if (q.sql.includes('from "codes"')) {
      return [{ code_set: 'hcpcs', code: 'A0427', description: 'ALS1 emergency' }];
    }
    if (q.sql.includes('from "claims" as "c"')) return row ? [row] : [];
    return [];
  });
  return { service: createClaimService(deps(db)), queries };
};

describe('claim service', () => {
  it('returns a claim with the meaning of its codes', async () => {
    const { service, queries } = setup();
    const res = await service.find('t-1', 'c1');
    assert.ok(res.ok);
    assert.deepEqual(res.value.claim, claim);
    assert.deepEqual(res.value.codes, { hcpcs: { A0427: 'ALS1 emergency' } });
    assert.equal(res.value.issues[0], 'Add a billing profile in Settings');
    assert.deepEqual(queries[0]?.parameters.slice(-2), ['t-1', 'c1']);
  });

  it('says what the claim lacks to be sent', async () => {
    const { db } = createRecordingDb((q: CompiledQuery) =>
      q.sql.includes('from "claims" as "c"')
        ? [
            {
              ...claim,
              number: '20261001-0012',
              revision: 1,
              condition_codes: [],
              patient_first_name: 'Ada',
              patient_last_name: 'Lovelace',
              patient_birth_date: '1950-12-10',
              coverages: [],
              lines: [],
              diagnoses: []
            }
          ]
        : []
    );
    const res = await createClaimService(deps(db)).find('t-1', 'c1');
    assert.ok(res.ok);
    assert.deepEqual(res.value.issues, [
      'The patient address has no street, city, state or ZIP code'
    ]);
  });

  it('reports a claim outside the agency as missing', async () => {
    const res = await setup(null).service.find('t-2', 'c1');
    assert.equal(res.ok, false);
    assert.deepEqual(res.ok ? null : res.failure, {
      code: 'not_found',
      message: 'Claim not found'
    });
  });

  it('searches the claims of the agency', async () => {
    const { service, queries } = setup();
    const res = await service.search('t-1', {
      page: 1,
      pageSize: 25,
      sort: 'created',
      dir: 'desc',
      status: []
    });
    assert.ok(res.ok);
    assert.equal(queries[0]?.parameters[0], 't-1');
  });
});

const place = { name: null, line: '1 Elm St', city: 'Dayton', state: 'OH', postalCode: '45402' };

const EDIT: ClaimEdit = {
  revision: 2,
  serviceDate: '2026-10-01',
  level: 'ALS1',
  emergency: true,
  loadedMiles: 7.4,
  originCode: 'R',
  destinationCode: 'H',
  transportReason: 'A',
  conditionCodes: ['06'],
  weightPounds: null,
  diagnoses: ['R07.9'],
  patient: {
    firstName: 'Ada',
    lastName: 'Lovelace',
    birthDate: '1950-12-10',
    sex: 'F',
    addressLine: '1 Elm St',
    city: 'Dayton',
    state: 'oh',
    postalCode: '45402'
  },
  pickup: place,
  destination: { ...place, name: 'Miami Valley Hospital' },
  priorAuthorization: null,
  signatureOnFile: true,
  note: 'Bed confined',
  coverages: [
    {
      payerId: null,
      payerName: 'Medicare',
      memberId: '1EG4',
      groupId: null,
      relationship: '18',
      insuredFirstName: null,
      insuredLastName: null
    }
  ],
  lines: [
    { code: 'A0427', modifiers: ['RH'], units: 1, unitCents: 85_000 },
    { code: 'A0425', modifiers: ['RH'], units: 7.4, unitCents: 1_250 }
  ]
};

const CURRENT = {
  revision: 2,
  status: 'on_hold',
  encounter_id: 'e-1',
  patient_id: 'p-1',
  classification: 'emergency',
  reasons: ['Emergency response']
};

const editing = (current: object | null = CURRENT) => {
  const { db, queries } = createRecordingDb((q: CompiledQuery) => {
    if (q.sql.startsWith('select "revision", "status"')) return current ? [current] : [];
    if (q.sql.startsWith('update "claims"')) return [{ revision: 3 }];
    if (q.sql.startsWith('insert into "events"')) return [{ id: 'ev-1' }];
    return [];
  });
  const { publish, events } = recordAnnouncements();
  return { service: createClaimService({ db, boss, publish }), queries, events };
};

describe('editing a claim', () => {
  it('saves the correction as a new revision that needs review, and says it was edited', async () => {
    const { service, queries, events } = editing();
    const res = await service.edit('t-1', 'u-1', 'c1', EDIT);
    assert.deepEqual(res, { ok: true, value: { id: 'c1', revision: 3 } });
    const sql = queries.map((q) => q.sql);
    assert.ok(sql.some((q) => q.endsWith('for update')));
    const update = queries.find((q) => q.sql.startsWith('update "claims"'));
    assert.match(update?.sql ?? '', /"revision" = revision \+ 1/);
    assert.ok(update?.parameters.includes('needs_review'));
    assert.ok(update?.parameters.includes('OH'));
    assert.ok(update?.parameters.includes('Bed confined'));
    assert.ok(update?.parameters.includes(94_250));
    const lines = queries.find((q) => q.sql.startsWith('insert into "claim_lines"'));
    assert.ok(lines?.parameters.includes(9_250));
    const diagnoses = queries.find((q) => q.sql.startsWith('insert into "claim_diagnoses"'));
    assert.ok(diagnoses?.parameters.includes('R079'));
    assert.ok(sql.some((q) => q.startsWith('select "r"."id" from "workflow_runs" as "r"')));
    const event = queries.find((q) => q.sql.startsWith('insert into "events"'));
    assert.deepEqual(event?.parameters, [
      't-1',
      'claim.edited',
      JSON.stringify({ claimId: 'c1', encounterId: 'e-1', revision: 3 }),
      'u-1'
    ]);
    assert.deepEqual(events, [{ agencyId: 't-1', event: { kind: 'claim', id: 'c1' } }]);
  });

  it('refuses an edit of a claim changed since it was opened, or of none', async () => {
    const stale = await editing().service.edit('t-1', 'u-1', 'c1', { ...EDIT, revision: 1 });
    assert.equal(stale.ok ? null : stale.failure.code, 'conflict');
    const missing = await editing(null).service.edit('t-1', 'u-1', 'c1', EDIT);
    assert.equal(missing.ok ? null : missing.failure.code, 'not_found');
  });

  it('says what is wrong with an edit it cannot save, and saves nothing', async () => {
    const wrong = async (patch: Partial<ClaimEdit>, message: RegExp) => {
      const { service, queries } = editing();
      const res = await service.edit('t-1', 'u-1', 'c1', { ...EDIT, ...patch });
      assert.equal(res.ok ? null : res.failure.code, 'invalid');
      assert.match(res.ok ? '' : res.failure.message, message);
      assert.ok(!queries.some((q) => q.sql.startsWith('update')));
    };
    await wrong({ diagnoses: ['chest pain'] }, /is not an ICD-10/);
    await wrong(
      { patient: { ...EDIT.patient, state: 'ZZ' } },
      /Patient address: ZZ is not a state/
    );
    await wrong({ pickup: { ...place, postalCode: '123' } }, /Pickup: 123 is not a ZIP code/);
    await wrong(
      { lines: [{ code: 'A0427', modifiers: ['RHX'], units: 1, unitCents: 1 }] },
      /invalid modifier RHX/
    );
  });
});
