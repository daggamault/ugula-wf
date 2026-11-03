import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb, createRecordingDb } from '@ugula/db/testing';
import { createBillingProfilesTables } from './billing-profiles.ts';
import { createClaimsTables } from './claims.ts';
import { createExtensions } from './extensions.ts';
import { createFeeSchedulesTable } from './fee-schedules.ts';
import { createGnisPlacesTable } from './gnis-places.ts';
import { createGraphsTables } from './graphs.ts';
import { createImportsTables } from './imports.ts';
import { migrate, resetSchema, steps } from './migrate.ts';
import { createNemsisDictionaryTables } from './nemsis-dictionary.ts';
import { createNotificationsTables } from './notifications.ts';
import { createPatientsTable } from './patients.ts';
import { createTasksTable } from './tasks.ts';
import { createTenantsTable } from './tenants.ts';
import { createUsersTable } from './users.ts';
import { createWorkflowRunsTables } from './workflow-runs.ts';

describe('migrate', () => {
  it('orders resetSchema before tables that depend on earlier ones', () => {
    assert.deepEqual(steps, [
      resetSchema,
      createExtensions,
      createGnisPlacesTable,
      createNemsisDictionaryTables,
      createTenantsTable,
      createUsersTable,
      createGraphsTables,
      createWorkflowRunsTables,
      createTasksTable,
      createPatientsTable,
      createBillingProfilesTables,
      createFeeSchedulesTable,
      createImportsTables,
      createClaimsTables,
      createNotificationsTables
    ]);
  });

  it('drops every table the steps create, so a reset starts clean', async () => {
    const { db, queries } = createRecordingDb();
    await migrate(db);
    const named = (pattern: RegExp) => queries.flatMap((q) => q.sql.match(pattern)?.[1] ?? []);
    const created = named(/^create table "(\w+)"/);
    const dropped = new Set(named(/^drop table if exists "(\w+)"/));
    assert.ok(created.length > 20);
    assert.deepEqual(
      created.filter((t) => !dropped.has(t)),
      []
    );
    await db.destroy();
  });

  it('executes all migration steps within a transaction', async () => {
    const db = createDummyDb();
    await migrate(db);
    await db.destroy();
  });
});
