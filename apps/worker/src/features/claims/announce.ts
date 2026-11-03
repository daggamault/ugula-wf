import type { ClaimStore } from '@ugula/billing';
import type { Announce } from '../../shared/live.ts';

export const announceClaims = (store: ClaimStore, announce: Announce): ClaimStore => {
  const changed = (runId: string, id: string) => announce(runId, { kind: 'claim', id });
  const after =
    <A extends [string, string, ...unknown[]], R>(write: (...args: A) => Promise<R>) =>
    async (...args: A) => {
      const result = await write(...args);
      await changed(args[0], args[1]);
      return result;
    };
  return {
    ...store,
    openDraft: async (runId, sourceKey, draft) => {
      const opened = await store.openDraft(runId, sourceKey, draft);
      await changed(runId, opened.id);
      return opened;
    },
    assignPatient: after(store.assignPatient),
    saveClaim: after(store.saveClaim),
    patchClaim: after(store.patchClaim),
    setStatus: after(store.setStatus),
    noteRevision: after(store.noteRevision),
    attachCycle: after(store.attachCycle),
    saveStatement: after(store.saveStatement),
    recordEvent: after(store.recordEvent),
    closeClaim: after(store.closeClaim)
  };
};
