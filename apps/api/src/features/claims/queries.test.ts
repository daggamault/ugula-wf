import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db';
import {
  claimBalance,
  findClaim,
  insertResponse,
  listClaimEvents,
  listClaims,
  listCoverages,
  reorderCoverages
} from './queries.ts';

describe('claim queries', () => {
  it('scope claims to the tenant with balances from the view and payers in billing order', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await listClaims(db, 't-1', {
      status: 'open',
      page: 2,
      pageSize: 25,
      sort: 'balance',
      dir: 'desc'
    });
    const [list] = queries;
    assert.ok(
      list?.sql.includes('inner join "claim_balances" as "b" on "b"."claim_id" = "c"."id"')
    );
    assert.ok(
      list?.sql.includes(
        'array((select coalesce(dp.name, cc.payer_name) as "payer" from "claim_coverages" as "cc" left join "payers" as "dp"'
      )
    );
    assert.ok(list?.sql.includes('"c"."tenant_id" = $1'));
    assert.ok(
      list?.sql.endsWith(
        'order by "b"."balance_cents" desc nulls last, "c"."id" desc limit $3 offset $4'
      )
    );
    assert.deepEqual(list?.parameters.slice(-2), [25, 25]);
  });

  it('finds a claim with its coverages, lines, diagnoses and cycle', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await findClaim(db, 't-1', 'c1');
    const [find] = queries;
    assert.ok(
      find?.sql.includes('left join "workflow_runs" as "r" on "r"."id" = "c"."cycle_run_id"')
    );
    assert.ok(find?.sql.includes('from "claim_coverages" as "cc"'));
    assert.ok(find?.sql.includes('order by "l"."position"'));
    assert.ok(find?.sql.includes('from "claim_diagnoses" as "d"'));
    assert.ok(find?.sql.includes('"c"."id" = $'));
  });

  it('flags coverages that already have billing activity', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await listCoverages(db, 'c1');
    assert.ok(
      queries[0]?.sql.includes(
        'exists ((select "e"."id" from "claim_events" as "e" where "e"."coverage_id" = "cc"."id")) as "has_events"'
      )
    );
  });

  it('removes, repositions and adds coverages, then touches the claim', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await reorderCoverages(db, 't-1', 'c1', {
      keep: [{ id: 'k1', position: 2 }],
      add: [{ payer: 'Aetna Inc.', position: 1 }],
      remove: ['r1']
    });
    const insert = queries.find((q) => q.sql.startsWith('insert into "claim_coverages"'));
    assert.ok(
      insert?.sql.includes(
        '(lower(name) = $5 or "id" in (select "payer_id" from "payer_aliases" where "tenant_id" = $6 and "alias_key" = $7))'
      )
    );
    assert.deepEqual(insert?.parameters.slice(3, 7), ['t-1', 'aetna inc.', 't-1', 'aetna inc']);
    assert.deepEqual(
      queries.map((q) => q.sql.split(' ').slice(0, 3).join(' ')),
      [
        'delete from "claim_coverages"',
        'update "claim_coverages" set',
        'insert into "claim_coverages"',
        'update "claims" set'
      ]
    );
  });

  it('reads balances, events with payer names and inserts responses idempotently', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('claim_balances') ? [{ balance_cents: 7 }] : []
    );
    assert.equal(await claimBalance(db, 'c1'), 7);
    await listClaimEvents(db, 'c1');
    await insertResponse(db, 'c1', 'u1', {
      requestId: 'req-1',
      coverageId: null,
      paidCents: 5,
      adjustedCents: 0,
      note: ''
    });
    const [, events, insert] = queries;
    assert.ok(events?.sql.includes('case when e.coverage_id is null then null else coalesce('));
    assert.ok(events?.sql.endsWith('order by "e"."created_at", "e"."id"'));
    assert.ok(insert?.parameters.includes('response'));
    assert.ok(insert?.sql.includes('on conflict ("claim_id", "source_key") do nothing'));
  });
});
