import type { ClaimStore, ClaimTaskStore } from '@ugula/billing';
import type { Announce } from '../../shared/live.ts';

const announcing =
  (announce: Announce) =>
  <A extends [string, string, ...unknown[]], R>(write: (...args: A) => Promise<R>) =>
  async (...args: A) => {
    const result = await write(...args);
    await announce(args[0], { kind: 'claim', id: args[1] });
    return result;
  };

export const announceClaimTasks = (store: ClaimTaskStore, announce: Announce): ClaimTaskStore => {
  const after = announcing(announce);
  return {
    setPayers: after(store.setPayers),
    postPayment: after(store.postPayment),
    addDocument: after(store.addDocument)
  };
};

export const announceClaims = (store: ClaimStore, announce: Announce): ClaimStore => {
  const changed = (runId: string, id: string) => announce(runId, { kind: 'claim', id });
  const after = announcing(announce);
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
    saveSubmission: after(store.saveSubmission),
    recordEvent: after(store.recordEvent),
    closeClaim: after(store.closeClaim),
    setResponsibility: after(store.setResponsibility)
  };
};
