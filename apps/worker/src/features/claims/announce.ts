import type { ClaimStore } from '@ugula/billing';
import type { Announce } from '../../shared/live.ts';

export const announceClaims = (store: ClaimStore, announce: Announce): ClaimStore => ({
  findClaim: store.findClaim,
  checkClaim: store.checkClaim,
  saveClaim: async (runId, claim) => {
    const saved = await store.saveClaim(runId, claim);
    await announce(runId, { kind: 'claim', id: saved.id });
    return saved;
  },
  reviewClaim: async (runId, review) => {
    const outcome = await store.reviewClaim(runId, review);
    if (outcome === 'recorded') await announce(runId, { kind: 'claim', id: review.claimId });
    return outcome;
  }
});
