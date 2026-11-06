import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import {
  findEventDocument,
  listClaimEvents,
  listClaimFiles,
  listClaimPayerFiles
} from './event-queries.ts';

describe('claim event queries', () => {
  it('reads events with payer names, amounts, and described reason and remark codes', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await listClaimEvents(db, 'c1', { page: 1, pageSize: 25, sort: 'amount', dir: 'asc' });
    const [events] = queries;
    assert.ok(events?.sql.includes('case when e.coverage_id is null then null else coalesce('));
    assert.ok(
      events?.sql.includes('order by e.paid_cents + e.adjusted_cents asc nulls last, "e"."id" asc')
    );
    assert.ok(events?.sql.includes('count(*) over ()'));
    assert.ok(
      events?.sql.includes(
        'select "a"."group_code" as "group", "a"."reason_code" as "reason", "a"."amount_cents" as "cents", "d"."description" from "claim_event_adjustments" as "a" left join "codes" as "d"'
      )
    );
    assert.ok(
      events?.sql.includes(
        'select "r"."code", "d"."description" from "claim_event_remarks" as "r" left join "codes" as "d"'
      )
    );
    assert.ok(events?.parameters.includes('carc') && events?.parameters.includes('rarc'));
  });

  it('lists the payer files that touched a claim with only the lines for that claim', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.deepEqual(await listClaimPayerFiles(db, 'c1'), []);
    const [q] = queries;
    assert.ok(q?.sql.includes('from "payer_files" as "f"'));
    assert.ok(q?.sql.includes('where exists (select "fi"."id" from "payer_file_items" as "fi"'));
    assert.deepEqual(q?.parameters, ['c1', 'c1']);
    await db.destroy();
  });

  it('lists the claim files that carry a batch or a document in order', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.deepEqual(await listClaimFiles(db, 'c1'), []);
    const [files] = queries;
    assert.ok(files?.sql.includes('("e"."batch_id" is not null or "e"."document" is not null)'));
    assert.ok(files?.sql.endsWith('order by "e"."created_at", "e"."id"'));
    assert.deepEqual(files?.parameters, ['carc', 'rarc', 'c1']);
    await db.destroy();
  });

  it('finds an event document within the agency only', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.equal(await findEventDocument(db, 't-1', 'c1', 'e1'), null);
    const [document] = queries;
    assert.ok(document?.sql.includes('"c"."agency_id" = $3 and "e"."document" is not null'));
    assert.deepEqual(document?.parameters, ['e1', 'c1', 't-1']);
    await db.destroy();
  });
});
