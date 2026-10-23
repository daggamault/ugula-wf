import type { Db } from '@ugula/db';
import { ok } from '../../shared/result.ts';
import { findBillingProfile, upsertBillingProfile } from './queries.ts';
import type { BillingProfileInput } from './schemas.ts';

export const createBillingProfileService = ({ db }: { db: Db }) => ({
  find: async (tenantId: string) =>
    ok({ profile: (await findBillingProfile(db, tenantId)) ?? null }),

  save: async (tenantId: string, profile: BillingProfileInput) =>
    ok({ profile: await upsertBillingProfile(db, tenantId, profile) })
});

export type BillingProfileService = ReturnType<typeof createBillingProfileService>;
