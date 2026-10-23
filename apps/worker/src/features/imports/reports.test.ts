import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db';
import { createReportStore } from './reports.ts';

const blobs = {
  getText: async () => '<x/>',
  getJson: async () => ({ ok: true }),
  putJson: async (key: string) => ({
    bucket: 'ugula',
    key,
    size: 1,
    contentType: 'application/json'
  })
};

describe('createReportStore', () => {
  it("only touches blobs under the run tenant's imports", async () => {
    const { db, queries } = createRecordingDb(() => [{ tenant_id: 't-1' }]);
    const store = createReportStore(db, blobs);
    const ref = (key: string) => ({ bucket: 'ugula', key });
    assert.equal(await store.getText('r1', ref('imports/t-1/a/pcrs.xml')), '<x/>');
    assert.deepEqual(await store.getJson('r1', ref('imports/t-1/a/pcrs.xml.reports/0.json')), {
      ok: true
    });
    assert.equal(
      (await store.putJson('r1', 'imports/t-1/sftp/x.json', {})).key,
      'imports/t-1/sftp/x.json'
    );
    assert.deepEqual(queries[0]?.parameters, ['r1']);
    await assert.rejects(() => store.getText('r1', ref('imports/t-2/a/pcrs.xml')), /not one of/);
    await assert.rejects(() => store.getText('r1', ref('imports/t-1/../t-2/x.xml')), /not one of/);
    await assert.rejects(() => store.putJson('r1', 'graphs/x.json', {}), /not one of/);
  });

  it('refuses everything for unknown runs', async () => {
    const store = createReportStore(createRecordingDb(() => []).db, blobs);
    await assert.rejects(
      () => store.getText('nope', { bucket: 'ugula', key: 'imports/t-1/x.xml' }),
      /not one of/
    );
  });
});
