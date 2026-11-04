import type { Db } from '@ugula/db';
import { ok } from '../../shared/result.ts';
import { findBillingProfile, upsertBillingProfile } from './queries.ts';
import type { BillingProfileInput } from './schemas.ts';

export const createBillingProfileService = ({ db }: { db: Db }) => ({
  find: async (agencyId: string) =>
    ok({ profile: (await findBillingProfile(db, agencyId)) ?? null }),

  save: async (agencyId: string, profile: BillingProfileInput) =>
    ok({ profile: await upsertBillingProfile(db, agencyId, profile) })
});

export type BillingProfileService = ReturnType<typeof createBillingProfileService>;
