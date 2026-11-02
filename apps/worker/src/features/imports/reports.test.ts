import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { createReportStore, fileNameOf } from './reports.ts';

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

  it('names GNIS places by feature id, skipping codes that are not ids', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 1215209, name: 'Erie' }]);
    const store = createReportStore(db, blobs);
    assert.deepEqual(await store.findPlaces(['1215209', 'x', '0']), { '1215209': 'Erie' });
    assert.ok(queries[0]?.sql.includes('from "gnis_places"'));
    assert.deepEqual(queries[0]?.parameters, [1215209]);
    assert.deepEqual(await store.findPlaces(['abc']), {});
    assert.equal(queries.length, 1);
  });

  it('records the import once per run and each report once per position', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('select') ? [{ tenant_id: 't-1' }] : [{ id: 'imp-1' }]
    );
    const report = (i: number) => ({
      bucket: 'ugula',
      key: `imports/t-1/a/pcrs.xml.reports/${i}.json`,
      size: 1,
      contentType: 'application/json'
    });
    await createReportStore(db, blobs).recordReports(
      'r1',
      { bucket: 'ugula', key: 'imports/t-1/a/pcrs.xml' },
      [
        { position: 0, pcrNumber: 'A', report: report(0) },
        { position: 1, pcrNumber: null, report: report(1) }
      ]
    );
    const imp = queries.find((q) => q.sql.startsWith('insert into "imports"'));
    assert.ok(imp?.sql.includes('on conflict ("run_id") do update set "report_count" = $'));
    assert.ok(imp?.parameters.includes('pcrs.xml') && imp.parameters.includes('manual'));
    const rows = queries.find((q) => q.sql.startsWith('insert into "import_reports"'));
    assert.ok(rows?.sql.includes('on conflict ("import_id", "position") do nothing'));
    assert.deepEqual(rows?.parameters.slice(0, 3), ['imp-1', 0, 'A']);
    assert.ok(String(rows?.parameters[7]).includes('pcrs.xml.reports/1.json'));
    await assert.rejects(
      () =>
        createReportStore(db, blobs).recordReports('r1', { bucket: 'ugula', key: 'x/y.xml' }, []),
      /not one of/
    );
  });

  it('names imports after the last path segment', () => {
    assert.equal(fileNameOf('imports/t/abc/pcrs.xml'), 'pcrs.xml');
    assert.equal(fileNameOf('loose'), 'loose');
  });

  it('refuses everything for unknown runs', async () => {
    const store = createReportStore(createRecordingDb(() => []).db, blobs);
    await assert.rejects(
      () => store.getText('nope', { bucket: 'ugula', key: 'imports/t-1/x.xml' }),
      /not one of/
    );
  });
});
