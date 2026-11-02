import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { findBillingProfile } from './queries.ts';

describe('billing profile queries', () => {
  it('reads the profile for one tenant', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.equal(await findBillingProfile(db, 't-1'), undefined);
    assert.ok(queries[0]?.sql.endsWith('from "billing_profiles" where "tenant_id" = $1'));
    await db.destroy();
  });
});
