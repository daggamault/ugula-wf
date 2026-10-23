import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ClaimStore } from '@ugula/billing';
import type { LiveEvent } from '@ugula/events';
import { announceClaims } from './announce.ts';

describe('announceClaims', () => {
  it('announces each claim change after the store has made it', async () => {
    const log: string[] = [];
    const store = {
      findByPcr: async () => 'c1',
      openClaim: async () => {
        log.push('open');
        return { id: 'c1', duplicate: false };
      },
      noteRevision: async () => void log.push('revision'),
      attachCycle: async () => void log.push('attach'),
      statementData: async () => {
        throw new Error('not used');
      },
      saveStatement: async () => void log.push('statement'),
      ledger: async () => null,
      recordEvent: async () => void log.push('event'),
      closeClaim: async () => void log.push('close')
    } as ClaimStore;
    const announced: [string, LiveEvent][] = [];
    const claims = announceClaims(store, async (runId, event) => {
      log.push('announce');
      announced.push([runId, event]);
    });
    assert.deepEqual(await claims.openClaim('r1', 'k', {} as never), {
      id: 'c1',
      duplicate: false
    });
    await claims.noteRevision('r1', 'c1', 'k', { bucket: 'b', key: 'k' });
    assert.equal(await claims.findByPcr('r1', 'PCR-1'), 'c1');
    await claims.attachCycle('r1', 'c1', 'r2');
    await claims.recordEvent('r1', 'c1', 'k', { kind: 'follow_up', coverageId: null, note: '' });
    await claims.closeClaim('r1', 'c1', 'k', 'paid');
    assert.equal(await claims.ledger('r1', 'c1'), null);
    assert.deepEqual(log, [
      'open',
      'announce',
      'revision',
      'announce',
      'attach',
      'announce',
      'event',
      'announce',
      'close',
      'announce'
    ]);
    assert.ok(
      announced.every(([runId, e]) => runId === 'r1' && e.kind === 'claim' && e.id === 'c1')
    );
  });
});
