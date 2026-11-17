import type { ClaimStore } from '@ugula/billing';
import type { Announce } from '../../shared/live.ts';

export const announceClaims = (store: ClaimStore, announce: Announce): ClaimStore => ({
  saveClaim: async (runId, claim) => {
    const saved = await store.saveClaim(runId, claim);
    await announce(runId, { kind: 'claim', id: saved.id });
    return saved;
  }
});
