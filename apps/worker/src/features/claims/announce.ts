import type { ClaimStore } from '@ugula/billing';
import type { Announce } from '../../shared/live.ts';

export const announceClaims = (store: ClaimStore, announce: Announce): ClaimStore => ({
  findClaim: store.findClaim,
  checkClaim: store.checkClaim,
  settleClaim: async (runId, claimId, settlement, note) => {
    const settled = await store.settleClaim(runId, claimId, settlement, note);
    if (settled === 'settled') await announce(runId, { kind: 'claim', id: claimId });
    return settled;
  },
  sendClaim: async (runId, claimId) => {
    const sent = await store.sendClaim(runId, claimId);
    if (sent.outcome === 'sent') await announce(runId, { kind: 'claim', id: claimId });
    return sent;
  },
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
