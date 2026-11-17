import type { EncounterStore } from '@ugula/nemsis';
import type { Announce } from '../../shared/live.ts';

export const announceEncounters = (store: EncounterStore, announce: Announce): EncounterStore => ({
  ...store,
  saveEncounter: async (runId, pcrNumber, data, reportId) => {
    const saved = await store.saveEncounter(runId, pcrNumber, data, reportId);
    await announce(runId, { kind: 'import', id: null });
    return saved;
  }
});
