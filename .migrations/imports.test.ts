import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb } from '@ugula/db';
import { buildImportReportsTable, buildImportsIndexes, buildImportsTable } from './imports.ts';

describe('imports tables', () => {
  it('compiles one import per ingest run with its source and uploader', async () => {
    const db = createDummyDb();
    const imports = buildImportsTable(db).compile().sql;
    assert.ok(
      imports.includes(
        '"run_id" uuid not null unique references "workflow_runs" ("id") on delete cascade'
      )
    );
    assert.ok(imports.includes("source in ('upload', 'sftp', 'manual')"));
    assert.ok(imports.includes('"uploaded_by" uuid references "users" ("id") on delete set null'));
    assert.ok(imports.includes('check (report_count >= 0)'));
    await db.destroy();
  });

  it('compiles one row per report in file order, unique by stored blob', async () => {
    const db = createDummyDb();
    const reports = buildImportReportsTable(db).compile().sql;
    assert.ok(reports.includes('references "imports" ("id") on delete cascade'));
    assert.ok(reports.includes('unique ("import_id", "position")'));
    const indexes = buildImportsIndexes(db).map((i) => i.compile().sql);
    assert.ok(
      indexes.includes(
        'create unique index "import_reports_report_key_unique" on "import_reports" ((report ->> \'key\'))'
      )
    );
    assert.equal(indexes.length, 3);
    await db.destroy();
  });
});
