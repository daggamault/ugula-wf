import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { findClaimDocument, listClaimDocuments } from './document-queries.ts';

describe('claim document queries', () => {
  it('lists the documents of a claim with who uploaded them and finds one in the agency', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.deepEqual(await listClaimDocuments(db, 'c1'), []);
    assert.equal(await findClaimDocument(db, 't-1', 'c1', 'd1'), null);
    const [list, find] = queries;
    assert.ok(list?.sql.includes('left join "users" as "u" on "u"."id" = "d"."uploaded_by"'));
    assert.deepEqual(find?.parameters, ['d1', 'c1', 't-1']);
  });
});
