import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { createClaimStore } from './queries.ts';

const ID = '0195f2a4-0000-7000-8000-000000000001';

const blobs = {
  putBytes: async (key: string, body: Uint8Array, contentType: string) => ({
    bucket: 'ugula',
    key,
    size: body.byteLength,
    contentType
  }),
  getBytes: async () => new Uint8Array()
};

describe('createClaimStore', () => {
  it('combines every claim store and leaves 837P files to the biller without a clearinghouse', async () => {
    const { db } = createRecordingDb((q) =>
      q.sql.startsWith('select "id", "agency_id" from "claims"')
        ? [{ id: ID, agency_id: 't-1' }]
        : q.sql.includes('from "claim_batches"')
          ? [{ id: 'b1', document: { bucket: 'ugula', key: 'b/7.txt' }, sent_as: null }]
          : []
    );
    const store = createClaimStore(db, blobs, { insert: async () => {} });
    assert.equal(await store.sendClaimFile('r1', ID, 7), 'manual');
    assert.equal(await store.ledger('r1', ID), null);
    assert.deepEqual(await store.facilityDirectory('r1'), []);
  });
});
