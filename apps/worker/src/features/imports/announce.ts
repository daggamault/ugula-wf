import type { ReportStore } from '@ugula/nemsis';
import type { Announce } from '../../shared/live.ts';

export const announceImports = (store: ReportStore, announce: Announce): ReportStore => ({
  ...store,
  recordReports: async (runId, file, importId, reports) => {
    const ids = await store.recordReports(runId, file, importId, reports);
    await announce(runId, { kind: 'import', id: null });
    return ids;
  }
});
