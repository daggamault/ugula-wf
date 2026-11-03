import type { ReportStore } from '@ugula/nemsis';
import type { Announce } from '../../shared/live.ts';

export const announceImports = (store: ReportStore, announce: Announce): ReportStore => ({
  ...store,
  recordReports: async (runId, file, reports) => {
    await store.recordReports(runId, file, reports);
    await announce(runId, { kind: 'import', id: null });
  }
});
