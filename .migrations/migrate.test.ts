import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb } from '@ugula/db';
import { createBillingProfilesTables } from './billing-profiles.ts';
import { createClaimsTables } from './claims.ts';
import { createExtensions } from './extensions.ts';
import { createFeeSchedulesTable } from './fee-schedules.ts';
import { createGnisPlacesTable } from './gnis-places.ts';
import { createGraphsTables } from './graphs.ts';
import { createImportsTables } from './imports.ts';
import { migrate, resetSchema, steps } from './migrate.ts';
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
      createTenantsTable,
      createUsersTable,
      createGraphsTables,
      createWorkflowRunsTables,
      createTasksTable,
      createPatientsTable,
      createBillingProfilesTables,
      createFeeSchedulesTable,
      createImportsTables,
      createClaimsTables
    ]);
  });

  it('executes all migration steps within a transaction', async () => {
    const db = createDummyDb();
    await migrate(db);
    await db.destroy();
  });
});
