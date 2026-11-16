import type { Db } from '@ugula/db';
import { isUniqueViolation } from '../../shared/http.ts';
import { fail, ok } from '../../shared/result.ts';
import { findBillingProfile, upsertBillingProfile } from './queries.ts';
import type { BillingProfileInput } from './schemas.ts';

export const createBillingProfileService = ({ db }: { db: Db }) => ({
  find: async (agencyId: string) =>
    ok({ profile: (await findBillingProfile(db, agencyId)) ?? null }),

  save: async (agencyId: string, profile: BillingProfileInput) => {
    try {
      return ok({ profile: await upsertBillingProfile(db, agencyId, profile) });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      return fail('conflict', `Another agency already uses submitter ID ${profile.submitterId}`);
    }
  }
});

export type BillingProfileService = ReturnType<typeof createBillingProfileService>;
