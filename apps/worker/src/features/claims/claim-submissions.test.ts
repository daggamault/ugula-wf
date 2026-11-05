import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Clearinghouse } from '@ugula/billing';
import { sampleSubmitter } from '@ugula/billing/testing';
import type { Db } from '@ugula/db';
import { createRecordingDb } from '@ugula/db/testing';
import type { BlobStore } from '@ugula/storage';
import type { CompiledQuery } from 'kysely';
import { createSubmissionStore } from './claim-submissions.ts';

const stored: { key: string; size: number; type: string }[] = [];

const blobs = {
  putBytes: async (key: string, body: Uint8Array, contentType: string) => {
    stored.push({ key, size: body.byteLength, type: contentType });
    return { bucket: 'ugula', key, size: body.byteLength, contentType };
  },
  getBytes: async () => new Uint8Array()
};

const createStore = (
  db: Db,
  b: Pick<BlobStore, 'putBytes' | 'getBytes'> = blobs,
  clearinghouse: (agencyId: string) => Promise<Clearinghouse | null> = async () => null
) => createSubmissionStore(db, b, async () => null, clearinghouse);

const ID = '0195f2a4-0000-7000-8000-000000000001';

const owned = { id: ID, agency_id: 't-1' };

const profile = {
  organization_name: sampleSubmitter.organizationName,
  npi: sampleSubmitter.npi,
  tax_id: sampleSubmitter.taxId,
  address_line: sampleSubmitter.addressLine,
  city: sampleSubmitter.city,
  state: sampleSubmitter.state,
  postal_code: sampleSubmitter.postalCode,
  phone: sampleSubmitter.phone,
  submitter_id: sampleSubmitter.submitterId,
  receiver_id: sampleSubmitter.receiverId,
  receiver_name: sampleSubmitter.receiverName,
  production: sampleSubmitter.production
};

const ownedClaim = (q: CompiledQuery) => q.sql.startsWith('select "id", "agency_id" from "claims"');

const sqlOf = (queries: readonly CompiledQuery[], prefix: string) =>
  queries.filter((q) => q.sql.startsWith(prefix));

describe('createSubmissionStore', () => {
  it('gives the submitter and no pending claim when the claim is not ready to submit', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('select "agency_id" from "workflow_runs"')
        ? [{ agency_id: 't-1' }]
        : q.sql.includes('from "billing_profiles"')
          ? [profile]
          : []
    );
    const store = createStore(db);
    assert.deepEqual(await store.submission('r1', ID, 'cov-1'), {
      submitter: sampleSubmitter,
      pending: null
    });
    const ready = queries.find((q) => q.sql.includes('inner join "patients" as "p"'));
    assert.ok(ready?.parameters.includes('t-1') && ready.parameters.includes('ready'));
    await assert.rejects(() => store.submission('r1', 'bad', 'cov-1'), /Claim bad does not exist/);
    const unknown = createStore(createRecordingDb().db);
    await assert.rejects(() => unknown.submission('r1', ID, 'cov-1'), /does not exist/);
  });

  it('files a ready claim as its own numbered 837P file and marks it submitted', async () => {
    stored.length = 0;
    const filing = (rows: { filed?: number; ready?: boolean; number?: number }) =>
      createRecordingDb((q) =>
        ownedClaim(q)
          ? [owned]
          : q.sql.includes('from "claim_events" as "e" inner join "claim_batches"')
            ? rows.filed === undefined
              ? []
              : [{ control_number: rows.filed }]
            : q.sql.includes('for update of "c"')
              ? rows.ready
                ? [{ id: ID }]
                : []
              : q.sql.startsWith('update "billing_profiles"')
                ? rows.number === undefined
                  ? []
                  : [{ control_number: rows.number }]
                : q.sql.startsWith('insert into "claim_batches"')
                  ? [{}]
                  : []
      );
    const file = {
      coverageId: 'cov-1',
      resubmission: true,
      totalCents: 95_000,
      production: false,
      build: (n: number) => `ISA*${n}~`
    };
    const fresh = filing({ ready: true, number: 7 });
    assert.deepEqual(await createStore(fresh.db).saveSubmission('r1', ID, 'k1', file), {
      controlNumber: 7
    });
    assert.match(stored[0]?.key ?? '', /^batches\/t-1\/[0-9a-f-]{36}\/837P-000000007\.txt$/);
    assert.deepEqual([stored[0]?.size, stored[0]?.type], [6, 'application/edi-x12']);
    const [batch] = sqlOf(fresh.queries, 'insert into "claim_batches"');
    assert.ok(batch?.parameters.includes(7) && batch.parameters.includes(95_000));
    const [event] = sqlOf(fresh.queries, 'insert into "claim_events"');
    assert.ok(event?.parameters.includes('resubmitted') && event.parameters.includes('cov-1'));
    assert.ok(event?.parameters.includes('837P file #7') && event.parameters.includes('k1'));
    const [marked] = sqlOf(fresh.queries, 'update "claims"');
    assert.deepEqual(marked?.parameters.slice(0, 1), ['submitted']);

    const replay = filing({ filed: 5 });
    assert.deepEqual(await createStore(replay.db).saveSubmission('r1', ID, 'k1', file), {
      controlNumber: 5
    });
    assert.equal(sqlOf(replay.queries, 'update').length, 0);
    const moved = filing({});
    assert.equal(await createStore(moved.db).saveSubmission('r1', ID, 'k1', file), 'stale');
    const used = filing({ ready: true });
    assert.equal(await createStore(used.db).saveSubmission('r1', ID, 'k1', file), 'exhausted');
    assert.equal(sqlOf(used.queries, 'insert').length, 0);
    assert.equal(stored.length, 1);
  });

  it('uploads a filed 837P to the clearinghouse once, or leaves it to the biller without one', async () => {
    const BATCH = '0195f2a4-0000-7000-8000-0000000000b1';
    const uploads: [string, string][] = [];
    const agencies: string[] = [];
    const clearinghouse = async (agencyId: string): Promise<Clearinghouse> => {
      agencies.push(agencyId);
      return {
        submitClaims: async (name, bytes) => {
          uploads.push([`${name}.CLP`, new TextDecoder().decode(bytes)]);
          return `${name}.CLP`;
        },
        submitEligibility: async (name) => name,
        submitClaimStatus: async (name) => name,
        checkEligibility: null,
        checkClaimStatus: null,
        inbox: async () => assert.fail('no inbox'),
        afterDownload: 'keep'
      };
    };
    const files = {
      ...blobs,
      getBytes: async (ref: { key: string }) => new TextEncoder().encode(`file:${ref.key}`)
    };
    const sending = (sentAs: string | null) =>
      createRecordingDb((q) =>
        ownedClaim(q)
          ? [owned]
          : q.sql.includes('from "claim_batches"')
            ? [{ id: BATCH, document: { bucket: 'ugula', key: 'b/7.txt' }, sent_as: sentAs }]
            : []
      );
    const fresh = sending(null);
    const send = createStore(fresh.db, files, clearinghouse);
    assert.deepEqual(await send.sendClaimFile('r1', ID, 7), {
      sentAs: '837P-000000007-0195f2a4.CLP'
    });
    assert.deepEqual(uploads, [['837P-000000007-0195f2a4.CLP', 'file:b/7.txt']]);
    assert.deepEqual(agencies, ['t-1']);
    const lookup = fresh.queries.find((q) => q.sql.includes('from "claim_batches"'));
    assert.deepEqual(lookup?.parameters, ['t-1', 7, ID]);
    assert.ok(lookup?.sql.includes('exists (select "e"."id" from "claim_events" as "e"'));
    const [mark] = sqlOf(fresh.queries, 'update "claim_batches"');
    assert.ok(mark?.sql.endsWith('and "sent_as" is null'));
    assert.deepEqual(mark?.parameters, ['837P-000000007-0195f2a4.CLP', BATCH]);

    const sent = sending('837P-000000007-0195f2a4.CLP');
    assert.deepEqual(await createStore(sent.db, files, clearinghouse).sendClaimFile('r1', ID, 7), {
      sentAs: '837P-000000007-0195f2a4.CLP'
    });
    assert.equal(uploads.length, 1);
    assert.equal(sqlOf(sent.queries, 'update').length, 0);

    const none = createRecordingDb((q) => (ownedClaim(q) ? [owned] : []));
    await assert.rejects(
      () => createStore(none.db, files, clearinghouse).sendClaimFile('r1', ID, 8),
      /No 837P file #8/
    );
    const offline = sending(null);
    assert.equal(await createStore(offline.db, files).sendClaimFile('r1', ID, 7), 'manual');
    assert.equal(sqlOf(offline.queries, 'update').length, 0);
  });
});
