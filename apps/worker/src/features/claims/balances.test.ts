import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import type { RunQueueClient } from '@ugula/run-queue';
import type { CompiledQuery } from 'kysely';
import { createBalanceStore, placementKey } from './balances.ts';

const ID = '0195f2a4-0000-7000-8000-000000000001';

const OTHER = '0195f2a4-0000-7000-8000-000000000002';

const USER = '0195f2a4-0000-7000-8000-0000000000e1';

const boss: RunQueueClient = { insert: async () => undefined };

const stored: { key: string; text: string; type: string }[] = [];

const blobs = {
  putBytes: async (key: string, body: Uint8Array, contentType: string) => {
    stored.push({ key, text: new TextDecoder().decode(body), type: contentType });
    return { bucket: 'ugula', key, size: body.byteLength, contentType };
  }
};

type World = {
  status?: string;
  balance?: number;
  otherBalance?: number;
  logged?: number | null;
  plan?: boolean;
  missed?: number | null;
  placed?: boolean;
  otherPatient?: string | null;
};

const world = (w: World = {}) => {
  const answer = (q: CompiledQuery): unknown[] => {
    const { sql, parameters } = q;
    if (sql.startsWith('select "id", "agency_id" from "claims"'))
      return [{ id: ID, agency_id: 't-1' }];
    if (sql.startsWith('select "id", "status", "patient_id" from "claims"')) {
      return [{ id: ID, status: w.status ?? 'patient_balance', patient_id: 'p1' }];
    }
    if (sql.startsWith('select "id", "number", "status", "patient_id" from "claims"')) {
      return [
        { id: ID, number: 'C-1', status: w.status ?? 'reconcile', patient_id: 'p1' },
        { id: OTHER, number: 'C-2', status: 'patient_balance', patient_id: w.otherPatient ?? 'p1' }
      ];
    }
    if (sql.startsWith('select "paid_cents" from "claim_events"')) {
      return w.logged === undefined || w.logged === null ? [] : [{ paid_cents: w.logged }];
    }
    if (sql.startsWith('select "balance_cents" from "claim_balances"')) {
      return [
        { balance_cents: parameters[0] === OTHER ? (w.otherBalance ?? 0) : (w.balance ?? 0) }
      ];
    }
    if (sql.startsWith('select "id" from "payment_plans"')) return w.plan ? [{ id: 'pp1' }] : [];
    if (sql.startsWith('update "payment_plans"')) {
      return w.missed === null ? [] : [{ missed_count: w.missed ?? 1, id: 'pp1' }];
    }
    if (sql.startsWith('select "id" from "collections_placements"')) {
      return w.placed ? [{ id: 'cp1' }] : [];
    }
    if (sql.includes('as zone')) return [{ zone: 'UTC' }];
    if (sql.startsWith('select "c"."number"')) {
      return [
        {
          number: 'C-1',
          pcr_number: 'PCR-1',
          service_date: '2026-10-01',
          first_name: 'Jane',
          last_name: 'Doe',
          birth_date: '1950-02-03',
          address_line: '1 Main St',
          city: 'Springfield',
          state: 'IL',
          postal_code: '62704',
          balance_cents: 64_220,
          agency_name: 'Acme Recovery',
          fee_pct: '30.00'
        }
      ];
    }
    if (sql.startsWith('select "c"."id", "c"."number"')) {
      return [
        {
          id: OTHER,
          number: 'C-2',
          pcr_number: null,
          service_date: '2026-09-01',
          balance_cents: 900
        }
      ];
    }
    return [];
  };
  const { db, queries } = createRecordingDb(answer);
  const store = createBalanceStore(db, blobs, boss, () => new Date('2026-11-17T15:00:00Z'));
  const inserted = (table: string) =>
    queries.filter((q) => q.sql.startsWith(`insert into "${table}"`)).map((q) => q.parameters);
  return { store, queries, inserted };
};

const terms = {
  installmentCents: 5_000,
  intervalDays: 30,
  firstDueOn: '2026-12-01',
  createdBy: USER
};

describe('createBalanceStore', () => {
  it('starts a plan on an open claim with a balance, logs it and signals the claim', async () => {
    const { store, queries, inserted } = world({ balance: 64_220 });
    assert.deepEqual(await store.startPlan('r1', ID, 'k1', terms), { status: 'started' });
    assert.deepEqual(inserted('payment_plans')[0], ['t-1', ID, 5_000, 30, '2026-12-01', USER]);
    const [event] = inserted('claim_events');
    assert.deepEqual(event?.slice(0, 5), [
      't-1',
      ID,
      'plan_started',
      'Payment plan: $50.00 every 30 days from 2026-12-01',
      0
    ]);
    assert.ok(queries.some((q) => q.sql.includes('"signals"')));
  });

  it('refuses a plan on a closed claim, one with nothing owed or one already on a plan', async () => {
    const refusal = async (w: World) => {
      const r = await world(w).store.startPlan('r1', ID, 'k1', terms);
      return r.status === 'refused' ? r.reason : r.status;
    };
    assert.equal(
      await refusal({ status: 'collections', balance: 1 }),
      'Only an open claim can be put on a payment plan'
    );
    assert.equal(await refusal({ balance: 0 }), 'Nothing is owed on the claim');
    assert.equal(
      await refusal({ balance: 1, plan: true }),
      'The claim already has an active payment plan'
    );
    assert.equal(await refusal({ status: 'collections', logged: 0 }), 'started');
  });

  it('counts a miss and ends a plan only while one is active, once per step', async () => {
    const missed = world({ missed: 2 });
    await missed.store.missPlan('r1', ID, 'k1', 'Missed');
    assert.equal(missed.inserted('claim_events')[0]?.[3], 'Missed (2 missed)');
    const none = world({ missed: null });
    await none.store.missPlan('r1', ID, 'k1', 'Missed');
    await none.store.endPlan('r1', ID, 'k2', { status: 'defaulted', note: 'Defaulted' });
    assert.deepEqual(none.inserted('claim_events'), []);
    const again = world({ logged: 0 });
    await again.store.missPlan('r1', ID, 'k1', 'Missed');
    assert.ok(!again.queries.some((q) => q.sql.startsWith('update')));
    const ended = world();
    await ended.store.endPlan('r1', ID, 'k2', { status: 'defaulted', note: 'Defaulted' });
    const update = ended.queries.find((q) => q.sql.startsWith('update "payment_plans"'));
    assert.deepEqual(update?.parameters.slice(0, 1), ['defaulted']);
    assert.deepEqual(ended.inserted('claim_events')[0]?.slice(2, 4), ['plan_ended', 'Defaulted']);
  });

  it("places a collections claim, rewrites the day's placement file and logs it", async () => {
    stored.length = 0;
    const { store, queries, inserted } = world({ status: 'collections', balance: 64_220 });
    await store.placeCollections('r1', ID, 'k1', { agencyName: 'Acme Recovery', feePct: 30 });
    assert.ok(queries.some((q) => q.sql.includes('pg_advisory_xact_lock')));
    assert.deepEqual(inserted('collections_placements')[0], [
      't-1',
      ID,
      'Acme Recovery',
      30,
      64_220,
      '2026-11-17'
    ]);
    assert.equal(stored[0]?.key, placementKey('t-1', '2026-11-17'));
    assert.equal(stored[0]?.key, 'collections/t-1/placements-2026-11-17.csv');
    assert.equal(stored[0]?.type, 'text/csv');
    assert.match(
      stored[0]?.text ?? '',
      /C-1,PCR-1,2026-10-01,"Doe, Jane",1950-02-03,.*\$642\.20,2026-11-17,Acme Recovery,30/
    );
    const [event] = inserted('claim_events');
    assert.deepEqual(event?.slice(2, 4), [
      'collections_placed',
      'Placed with Acme Recovery (30% fee): $642.20'
    ]);
  });

  it('leaves a claim alone once it is placed, reopened or settled', async () => {
    for (const w of [
      { status: 'collections', balance: 5, placed: true },
      { status: 'reconcile', balance: 5 },
      { status: 'collections', balance: 0 }
    ]) {
      const { store, inserted } = world(w);
      await store.placeCollections('r1', ID, 'k1', { agencyName: 'Acme', feePct: 30 });
      assert.deepEqual(inserted('collections_placements'), []);
    }
  });

  it("lists the patient's other open claims that owe something", async () => {
    const { store, queries } = world();
    assert.deepEqual(await store.creditTargets('r1', ID), [
      { claimId: OTHER, reference: 'C-2 · 2026-09-01', balanceCents: 900 }
    ]);
    const list = queries.at(-1);
    assert.ok(
      list?.sql.includes('"c"."patient_id" = (select "s"."patient_id" from "claims" as "s"')
    );
    assert.ok(list?.sql.includes('"b"."balance_cents" > $'));
  });

  it('moves no more than the credit or what the other claim owes, as a pair of entries', async () => {
    const { store, inserted, queries } = world({ balance: -1_500, otherBalance: 900 });
    assert.deepEqual(
      await store.transferCredit('r1', ID, 'k1', { toClaimId: OTHER, note: 'Same patient' }),
      {
        status: 'transferred',
        cents: 900
      }
    );
    assert.deepEqual(
      inserted('claim_events').map((p) => p.slice(1, 6)),
      [
        [ID, 'credit_transferred', 'Credit of $9.00 moved to claim C-2: Same patient', -900, null],
        [
          OTHER,
          'credit_transferred',
          'Credit of $9.00 moved from claim C-1: Same patient',
          900,
          null
        ]
      ]
    );
    assert.ok(queries.some((q) => q.sql.includes('for update')));
    const repeated = world({ logged: -700 });
    assert.deepEqual(
      await repeated.store.transferCredit('r1', ID, 'k1', { toClaimId: OTHER, note: '' }),
      {
        status: 'transferred',
        cents: 700
      }
    );
  });

  it('refuses a transfer to itself, another patient, a closed claim or without a credit', async () => {
    const reason = async (w: World, to = OTHER) => {
      const r = await world(w).store.transferCredit('r1', ID, 'k1', { toClaimId: to, note: '' });
      return r.status === 'refused' ? r.reason : r.status;
    };
    assert.equal(await reason({}, ID), 'Choose another claim of the patient');
    assert.equal(await reason({}, 'x'), 'Choose another claim of the patient');
    assert.equal(
      await reason({ otherPatient: 'p2' }),
      'The other claim is not for the same patient'
    );
    assert.equal(await reason({ balance: 0, otherBalance: 5 }), 'No credit is left on the claim');
    assert.equal(await reason({ balance: -5, otherBalance: 0 }), 'The other claim owes nothing');
  });
});
