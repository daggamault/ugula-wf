import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { createAgencyOf } from '../../shared/tenancy.ts';
import { createReportStore, fileNameOf } from './reports.ts';

const recordingBlobs = () => {
  const calls: unknown[][] = [];
  return {
    calls,
    getText: async (ref: unknown) => {
      calls.push(['getText', ref]);
      return '<x/>';
    },
    getJson: async (ref: unknown) => {
      calls.push(['getJson', ref]);
      return { ok: true };
    },
    putJson: async (key: string, value: unknown) => {
      calls.push(['putJson', key, value]);
      return { bucket: 'ugula', key, size: 1, contentType: 'application/json' };
    }
  };
};

const IMPORT =
  'insert into "imports" ("agency_id", "run_id", "source", "file_name", "file", "report_count") values ((select "agency_id" from "workflow_runs" where "id" = $1), $2, $3, $4, $5, $6) on conflict ("run_id") do update set "report_count" = $7 returning "id", "agency_id"';

const ref = (key: string) => ({ bucket: 'ugula', key });

describe('createReportStore', () => {
  it("reads and writes blobs under the run agency's imports", async () => {
    const { db, queries } = createRecordingDb(() => [{ agency_id: 't-1' }]);
    const blobs = recordingBlobs();
    const store = createReportStore(
      db,
      blobs,
      createAgencyOf(db, () => undefined)
    );
    assert.equal(await store.getText('r1', ref('imports/t-1/a/pcrs.xml')), '<x/>');
    assert.deepEqual(await store.getJson('r1', ref('imports/t-1/a/pcrs.xml.reports/0.json')), {
      ok: true
    });
    assert.deepEqual(await store.putJson('r1', 'imports/t-1/sftp/x.json', { n: 1 }), {
      bucket: 'ugula',
      key: 'imports/t-1/sftp/x.json',
      size: 1,
      contentType: 'application/json'
    });
    assert.deepEqual(blobs.calls, [
      ['getText', ref('imports/t-1/a/pcrs.xml')],
      ['getJson', ref('imports/t-1/a/pcrs.xml.reports/0.json')],
      ['putJson', 'imports/t-1/sftp/x.json', { n: 1 }]
    ]);
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      Array.from({ length: 3 }, () => [
        'select "agency_id" from "workflow_runs" where "id" = $1',
        ['r1']
      ])
    );
  });

  it("refuses blobs of another agency, outside imports or climbing out of the agency's folder", async () => {
    const blobs = recordingBlobs();
    const store = createReportStore(createRecordingDb().db, blobs, async () => 't-1');
    for (const key of [
      'imports/t-2/a/pcrs.xml',
      'imports/t-10/a/pcrs.xml',
      'imports/t-1/../t-2/x.xml',
      'graphs/imports/t-1/x.json'
    ]) {
      await assert.rejects(
        () => store.getText('r1', ref(key)),
        new RegExp(`Blob ${key.replaceAll('.', '\\.')} is not one of this agency's imports`)
      );
      await assert.rejects(() => store.getJson('r1', ref(key)), /not one of/);
      await assert.rejects(() => store.putJson('r1', key, {}), /not one of/);
    }
    assert.deepEqual(blobs.calls, []);
  });

  it('refuses everything for unknown runs', async () => {
    const blobs = recordingBlobs();
    const store = createReportStore(createRecordingDb().db, blobs, async () => undefined);
    await assert.rejects(() => store.getText('nope', ref('imports/t-1/x.xml')), /not one of/);
    await assert.rejects(
      () => store.recordReports('nope', ref('imports/t-1/x.xml'), []),
      /not one of/
    );
    assert.deepEqual(blobs.calls, []);
  });

  it('names GNIS places by feature id, skipping codes that are not positive whole ids', async () => {
    const { db, queries } = createRecordingDb(() => [
      { id: 1215209, name: 'Erie' },
      { id: 7, name: 'Ada' }
    ]);
    const store = createReportStore(db, recordingBlobs(), async () => 't-1');
    assert.deepEqual(await store.findPlaces(['1215209', 'x', '0', '-3', '1.5', '', '7']), {
      '1215209': 'Erie',
      '7': 'Ada'
    });
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [['select "id", "name" from "gnis_places" where "id" in ($1, $2)', [1215209, 7]]]
    );
    assert.deepEqual(await store.findPlaces(['abc', '9007199254740993']), {});
    assert.deepEqual(await store.findPlaces([]), {});
    assert.equal(queries.length, 1);
  });

  it('records the import once per run and each report once per position', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'imp-1', agency_id: 't-1' }]);
    const report = (i: number) => ({
      bucket: 'ugula',
      key: `imports/t-1/a/pcrs.xml.reports/${i}.json`,
      size: 1,
      contentType: 'application/json'
    });
    const file = ref('imports/t-1/a/pcrs.xml');
    await createReportStore(db, recordingBlobs(), async () => 't-1').recordReports('r1', file, [
      { position: 0, pcrNumber: 'A', report: report(0) },
      { position: 1, pcrNumber: null, report: report(1) }
    ]);
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [IMPORT, ['r1', 'r1', 'manual', 'pcrs.xml', JSON.stringify(file), 2, 2]],
        [
          'insert into "import_reports" ("agency_id", "import_id", "position", "pcr_number", "report", "report_key") values ($1, $2, $3, $4, $5, $6), ($7, $8, $9, $10, $11, $12) on conflict ("import_id", "position") do nothing',
          [
            't-1',
            'imp-1',
            0,
            'A',
            JSON.stringify(report(0)),
            report(0).key,
            't-1',
            'imp-1',
            1,
            null,
            JSON.stringify(report(1)),
            report(1).key
          ]
        ]
      ]
    );
  });

  it('records an import without reports and inserts none', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'imp-1', agency_id: 't-1' }]);
    const file = ref('imports/t-1/a/empty.xml');
    await createReportStore(db, recordingBlobs(), async () => 't-1').recordReports('r1', file, []);
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [[IMPORT, ['r1', 'r1', 'manual', 'empty.xml', JSON.stringify(file), 0, 0]]]
    );
  });
});

describe('fileNameOf', () => {
  it('names imports after the last path segment, or the whole key without one', () => {
    assert.equal(fileNameOf('imports/t/abc/pcrs.xml'), 'pcrs.xml');
    assert.equal(fileNameOf('loose'), 'loose');
    assert.equal(fileNameOf('imports/t/abc/'), 'imports/t/abc/');
  });
});
