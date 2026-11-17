import { claimCodeRefs } from '@ugula/billing';
import { type Db, describeCodes } from '@ugula/db';
import { fail, ok } from '../../shared/result.ts';
import { type ClaimFilters, findClaim, searchClaims } from './queries.ts';

type ClaimServiceDeps = { db: Db };

const notFound = fail('not_found', 'Claim not found');

export const createClaimService = ({ db }: ClaimServiceDeps) => ({
  search: async (agencyId: string, filters: ClaimFilters) =>
    ok(await searchClaims(db, agencyId, filters)),

  find: async (agencyId: string, id: string) => {
    const claim = await findClaim(db, agencyId, id);
    if (!claim) return notFound;
    return ok({ claim, codes: await describeCodes(db, claimCodeRefs(claim)) });
  }
});

export type ClaimService = ReturnType<typeof createClaimService>;
