import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import type { RunQueueClient } from '@ugula/run-queue';
import type { CompiledQuery } from 'kysely';
import { createFacilityStore } from './claim-facilities.ts';

const ID = '0195f2a4-0000-7000-8000-000000000001';

const boss: RunQueueClient = { insert: async () => undefined };

const owned = { id: ID, agency_id: 't-1' };

const ownedClaim = (q: CompiledQuery) => q.sql.startsWith('select "id", "agency_id" from "claims"');

const sqlOf = (queries: readonly CompiledQuery[], prefix: string) =>
  queries.filter((q) => q.sql.startsWith(prefix));

describe('createFacilityStore', () => {
  it('bills a claim to a facility of its own agency once per step, and back to the payers', async () => {
    const FACILITY_ID = '0195f2a4-0000-7000-8000-0000000000f1';
    const respond = ({ recorded = false, status = 'needs_review', known = true } = {}) =>
      createRecordingDb((q) =>
        ownedClaim(q)
          ? [owned]
          : q.sql.includes('for update')
            ? [{ id: ID, status, patient_id: null }]
            : q.sql.startsWith('select "id" from "claim_events"') && recorded
              ? [{ id: 'e0' }]
              : q.sql.startsWith('select "id" from "facilities"') && known
                ? [{ id: FACILITY_ID }]
                : []
      );
    const { db, queries } = respond();
    await createFacilityStore(db, boss).setResponsibility('r1', ID, 'k', {
      party: 'facility',
      facilityId: FACILITY_ID,
      note: 'Contract with Oak Manor'
    });
    assert.ok(queries.some((q) => q.sql.endsWith('for update')));
    const [lookup] = sqlOf(queries, 'select "id" from "facilities"');
    assert.deepEqual(lookup?.parameters, [FACILITY_ID, 't-1']);
    const [event] = sqlOf(queries, 'insert into "claim_events"');
    assert.ok(event?.parameters.includes('responsibility'));
    assert.ok(event?.parameters.includes('Contract with Oak Manor'));
    const [update] = sqlOf(queries, 'update "claims"');
    assert.deepEqual(update?.parameters.slice(0, 1), [FACILITY_ID]);
    assert.equal(sqlOf(queries, 'insert into "signals"').length, 1);
    const back = respond();
    await createFacilityStore(back.db, boss).setResponsibility('r1', ID, 'k', {
      party: 'payer',
      facilityId: null,
      note: 'Billed to the payers'
    });
    const [reset] = sqlOf(back.queries, 'update "claims"');
    assert.deepEqual(reset?.parameters, [null, ID]);
    const facility = { party: 'facility' as const, facilityId: FACILITY_ID, note: '' };
    for (const [opts, fault] of [
      [{ known: false }, /is not in the facility directory/],
      [{ status: 'paid' }, /already closed/]
    ] as const) {
      const refused = respond(opts);
      await assert.rejects(
        () => createFacilityStore(refused.db, boss).setResponsibility('r1', ID, 'k', facility),
        fault
      );
      assert.equal(sqlOf(refused.queries, 'update "claims"').length, 0);
    }
    await assert.rejects(
      () =>
        createFacilityStore(respond().db, boss).setResponsibility('r1', ID, 'k', {
          party: 'facility',
          facilityId: null,
          note: ''
        }),
      /Choose the facility/
    );
    const replay = respond({ recorded: true, status: 'paid' });
    await createFacilityStore(replay.db, boss).setResponsibility('r1', ID, 'k', {
      party: 'payer',
      facilityId: null,
      note: ''
    });
    assert.equal(sqlOf(replay.queries, 'update "claims"').length, 0);
  });

  it('lists the facilities of the run agency with a known kind', async () => {
    const { db, queries } = createRecordingDb(() => [
      { id: 'f1', name: 'Oak Manor', kind: 'snf', contract: true },
      { id: 'f2', name: 'Odd', kind: 'spa', contract: false }
    ]);
    assert.deepEqual(await createFacilityStore(db, boss).facilityDirectory('r1'), [
      { id: 'f1', name: 'Oak Manor', kind: 'snf', contract: true }
    ]);
    assert.ok(queries.at(-1)?.sql.endsWith('order by "name"'));
  });
});
