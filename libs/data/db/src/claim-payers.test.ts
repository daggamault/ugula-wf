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
    const plan = planPayerOrder(
      [coverage('m', 'Medicare'), coverage('b', 'Blue Plan'), coverage('x', 'Old Plan')],
      ['blue plan', 'Aetna', 'Medicare']
    );
    assert.deepEqual(plan.keep, [
      { id: 'b', position: 1 },
      { id: 'm', position: 3 }
    ]);
    assert.deepEqual(plan.add, [{ payer: 'Aetna', position: 2 }]);
    assert.deepEqual(plan.remove, ['x']);
  });

  it('removes, repositions and adds coverages linked to the directory, then touches the claim', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await reorderCoverages(db, 't-1', 'c1', {
      keep: [{ id: 'k1', position: 2 }],
      add: [{ payer: 'Aetna Inc.', position: 1 }],
      remove: ['r1']
    });
    const insert = queries.find((q) => q.sql.startsWith('insert into "claim_coverages"'));
    assert.match(
      insert?.sql ?? '',
      /\(lower\(name\) = \$\d+ or "id" in \(select "payer_id" from "payer_aliases" where "agency_id" = \$\d+ and "alias_key" = \$\d+\)\)/
    );
    assert.ok(insert?.parameters.includes('aetna inc'));
    assert.deepEqual(insert?.parameters.slice(0, 5), ['c1', 't-1', 1, 'Aetna Inc.', '18']);
    assert.deepEqual(
      queries.map((q) => q.sql.trim().split(/\s+/).slice(0, 3).join(' ')),
      [
        'delete from "claim_coverages"',
        'update claim_coverages cc',
        'insert into "claim_coverages"',
        'update "claims" set'
      ]
    );
  });

  it('sets the payers of an open claim and signals it', async () => {
    const { db, queries } = claimDb('submitted', [coverage('m', 'Medicare')]);
    assert.deepEqual(await setClaimPayers(db, boss, 't-1', 'c1', ['Aetna', 'Medicare']), {
      ok: true,
      value: { payers: ['Aetna', 'Medicare'] }
    });
    assert.ok(queries.some((q) => q.sql.includes('into "signals"')));
  });

  it('refuses drafts, closed claims and removing a payer with billing activity', async () => {
    const draft = await setClaimPayers(claimDb('draft', []).db, boss, 't-1', 'c1', []);
    assert.match(draft.ok ? '' : draft.failure.message, /still a draft/);
    const paid = await setClaimPayers(claimDb('paid', []).db, boss, 't-1', 'c1', []);
    assert.match(paid.ok ? '' : paid.failure.message, /already closed/);
    const { db, queries } = claimDb('submitted', [coverage('m', 'Medicare', true)]);
    const busy = await setClaimPayers(db, boss, 't-1', 'c1', []);
    assert.equal(
      busy.ok ? '' : busy.failure.message,
      'Medicare already has billing activity on this claim, so it cannot be removed'
    );
    assert.ok(!queries.some((q) => q.sql.startsWith('delete')));
  });
});
