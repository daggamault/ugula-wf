import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import {
  findClaimDocument,
  insertClaimDocument,
  insertDocumentEvent,
  listClaimDocuments
} from './document-queries.ts';

describe('claim document queries', () => {
  it('lists, finds and stores claim documents and logs their arrival', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('insert into "claim_documents"') ? [{ id: 'd1' }] : []
    );
    assert.deepEqual(await listClaimDocuments(db, 'c1'), []);
    assert.equal(await findClaimDocument(db, 't-1', 'c1', 'd1'), null);
    const ref = {
      bucket: 'ugula',
      key: 'documents/t-1/c1/x/pcs.pdf',
      size: 3,
      contentType: 'application/pdf'
    };
    assert.deepEqual(
      await insertClaimDocument(db, {
        agencyId: 't-1',
        claimId: 'c1',
        kind: 'pcs',
        fileName: 'pcs.pdf',
        document: ref,
        signedOn: null,
        uploadedBy: 'u1'
      }),
      { id: 'd1' }
    );
    await insertDocumentEvent(db, 'c1', 'PCS uploaded', 'u1');
    const [list, find, insert, event] = queries;
    assert.ok(list?.sql.includes('left join "users" as "u" on "u"."id" = "d"."uploaded_by"'));
    assert.deepEqual(find?.parameters, ['d1', 'c1', 't-1']);
    assert.ok(insert?.parameters.includes(JSON.stringify(ref)));
    assert.deepEqual(event?.parameters, ['c1', 'document', 'PCS uploaded', 'u1']);
  });
});
