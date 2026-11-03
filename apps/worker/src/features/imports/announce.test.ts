import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LiveEvent } from '@ugula/live';
import type { ReportStore } from '@ugula/nemsis';
import { announceImports } from './announce.ts';

describe('announceImports', () => {
  it('announces an import once its reports are recorded and passes other calls through', async () => {
    const log: string[] = [];
    const store = {
      recordReports: async () => void log.push('record'),
      findPlaces: async () => ({ '1': 'Springfield' })
    } as unknown as ReportStore;
    const announced: [string, LiveEvent][] = [];
    const imports = announceImports(store, async (runId, event) => {
      log.push('announce');
      announced.push([runId, event]);
    });
    await imports.recordReports('r1', { bucket: 'b', key: 'k' }, []);
    assert.deepEqual(log, ['record', 'announce']);
    assert.deepEqual(announced, [['r1', { kind: 'import', id: null }]]);
    assert.deepEqual(await imports.findPlaces(['1']), { '1': 'Springfield' });
  });

  it('does not announce when recording fails', async () => {
    const store = {
      recordReports: async () => {
        throw new Error('disk full');
      }
    } as unknown as ReportStore;
    let announced = 0;
    const imports = announceImports(store, async () => void announced++);
    await assert.rejects(
      () => imports.recordReports('r1', { bucket: 'b', key: 'k' }, []),
      /disk full/
    );
    assert.equal(announced, 0);
  });
});
