import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RunQueueClient } from '@ugula/run-queue';
import { planPayerOrder, reorderCoverages, setClaimPayers } from './claim-payers.ts';
import { createRecordingDb } from './testing.ts';

const coverage = (id: string, payer: string, has_events = false) => ({ id, payer, has_events });

const boss: RunQueueClient = { insert: async () => undefined };

const claimDb = (status: string, coverages: ReturnType<typeof coverage>[]) =>
  createRecordingDb(({ sql }) => {
    if (sql.includes('for update')) return [{ id: 'c1', status, patient_id: 'p1' }];
    if (sql.includes('from "claim_coverages"')) return coverages;
    return [];
  });

describe('claim payers', () => {
  it('keeps payers still named in their new order, adds new names and removes the rest', () => {
    const old = coverage('x', 'Old Plan');
    assert.deepEqual(
      planPayerOrder(
        [coverage('m', 'Medicare'), coverage('b', 'Blue Plan'), old],
        ['blue plan', 'Aetna', 'Medicare']
      ),
      {
        keep: [
          { id: 'b', position: 1 },
          { id: 'm', position: 3 }
        ],
        add: [{ payer: 'Aetna', position: 2 }],
        remove: ['x'],
        removed: [old]
      }
    );
  });

  it('removes every payer when no names are given', () => {
    const medicare = coverage('m', 'Medicare');
    assert.deepEqual(planPayerOrder([medicare], []), {
      keep: [],
      add: [],
      remove: ['m'],
      removed: [medicare]
    });
  });

  it('removes, repositions and adds coverages linked to the directory, then touches the claim', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await reorderCoverages(db, 't-1', 'c1', {
      keep: [
        { id: 'k1', position: 2 },
        { id: 'k2', position: 3 }
      ],
      add: [{ payer: 'Aetna Inc.', position: 1 }],
      remove: ['r1']
    });
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        ['delete from "claim_coverages" where "claim_id" = $1 and "id" in ($2)', ['c1', 'r1']],
        [
          '\n      update claim_coverages cc set position = v.position\n      from (values ($1::uuid, $2::smallint), ($3::uuid, $4::smallint))\n        as v (id, position)\n      where cc.id = v.id and cc.claim_id = $5',
          ['k1', 2, 'k2', 3, 'c1']
        ],
        [
          'insert into "claim_coverages" ("claim_id", "agency_id", "position", "payer_name", "relationship", "payer_id") values ($1, $2, $3, $4, $5, (select "id" from "payers" where "agency_id" = $6 and (lower(name) = $7 or "id" in (select "payer_id" from "payer_aliases" where "agency_id" = $8 and "alias_key" = $9)) order by lower(name) = $10 desc limit $11))',
          [
            'c1',
            't-1',
            1,
            'Aetna Inc.',
            '18',
            't-1',
            'aetna inc.',
            't-1',
            'aetna inc',
            'aetna inc.',
            1
          ]
        ],
        ['update "claims" set "updated_at" = now() where "id" = $1', ['c1']]
      ]
    );
  });

  it('only touches the claim when there is nothing to remove, reposition or add', async () => {
    const { db, queries } = createRecordingDb();
    await reorderCoverages(db, 't-1', 'c1', { keep: [], add: [], remove: [] });
    assert.deepEqual(
      queries.map((q) => q.sql),
      ['update "claims" set "updated_at" = now() where "id" = $1']
    );
  });

  it('sets the payers of an open claim of the agency and signals it', async () => {
    const { db, queries } = claimDb('submitted', [coverage('m', 'Medicare')]);
    assert.deepEqual(await setClaimPayers(db, boss, 't-1', 'c1', ['Aetna', 'medicare']), {
      ok: true,
      value: { payers: ['Aetna', 'medicare'] }
    });
    assert.deepEqual(
      queries.map((q) => [q.sql.trim().split(/\s+/).slice(0, 3).join(' '), q.parameters]),
      [
        ['select "id", "status",', ['c1', 't-1']],
        ['select "cc"."id", coalesce(dp.name,', ['c1']],
        ['update claim_coverages cc', ['m', 2, 'c1']],
        [
          'insert into "claim_coverages"',
          ['c1', 't-1', 1, 'Aetna', '18', 't-1', 'aetna', 't-1', 'aetna', 'aetna', 1]
        ],
        ['update "claims" set', ['c1']],
        ['insert into "signals"', ['t-1', 'claim:c1', 1]],
        ['select "id", state', ['t-1', 'claim:c1', 'suspended']]
      ]
    );
  });

  it('refuses drafts, closed claims and removing a payer with billing activity', async () => {
    const draft = await setClaimPayers(claimDb('draft', []).db, boss, 't-1', 'c1', []);
    assert.deepEqual(draft, {
      ok: false,
      failure: {
        code: 'conflict',
        message: 'This claim is still a draft. Finish its PCR tasks before changing it.'
      }
    });
    const paid = await setClaimPayers(claimDb('paid', []).db, boss, 't-1', 'c1', []);
    assert.deepEqual(paid, {
      ok: false,
      failure: { code: 'conflict', message: 'Claim is already closed' }
    });
    const { db, queries } = claimDb('submitted', [
      coverage('b', 'Blue Plan'),
      coverage('m', 'Medicare', true)
    ]);
    assert.deepEqual(await setClaimPayers(db, boss, 't-1', 'c1', []), {
      ok: false,
      failure: {
        code: 'conflict',
        message: 'Medicare already has billing activity on this claim, so it cannot be removed'
      }
    });
    assert.equal(queries.length, 2);
  });

  it('reports a claim it cannot find without touching anything', async () => {
    const { db, queries } = createRecordingDb();
    assert.deepEqual(await setClaimPayers(db, boss, 't-1', 'c1', ['Aetna']), {
      ok: false,
      failure: { code: 'not_found', message: 'Claim not found' }
    });
    assert.equal(queries.length, 1);
  });
});
