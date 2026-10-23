import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb } from '@ugula/db';
import {
  buildGraphsTable,
  buildGraphVersionsDraftIndex,
  buildGraphVersionsTable,
  publishedImmutableTrigger
} from './graphs.ts';

describe('graphs tables', () => {
  it('compiles graphs with tenant-scoped unique keys and kind checks', async () => {
    const db = createDummyDb();
    const tableSql = buildGraphsTable(db).compile().sql;
    assert.ok(tableSql.includes('create table "graphs"'));
    assert.ok(tableSql.includes('unique nulls not distinct ("tenant_id", "key")'));
    assert.ok(tableSql.includes("check (kind in ('workflow', 'node'))"));
    assert.ok(tableSql.includes("key not like 'std.%'"));
    await db.destroy();
  });

  it('compiles immutable versioned definitions with one draft per graph', async () => {
    const db = createDummyDb();
    const tableSql = buildGraphVersionsTable(db).compile().sql;
    assert.ok(tableSql.includes('"dependencies" uuid[] default \'{}\' not null'));
    assert.ok(tableSql.includes('unique ("graph_id", "version")'));
    const draftSql = buildGraphVersionsDraftIndex(db).compile().sql;
    assert.ok(draftSql.includes('create unique index "idx_graph_versions_draft"'));
    assert.ok(draftSql.includes('where "published_at" is null'));
    assert.ok(
      publishedImmutableTrigger.compile(db).sql.includes('before update on graph_versions')
    );
    await db.destroy();
  });
});
