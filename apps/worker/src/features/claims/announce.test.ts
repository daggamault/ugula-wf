import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ClaimStore } from '@ugula/billing';
import type { LiveEvent } from '@ugula/live';
import { announceClaims } from './announce.ts';

describe('announceClaims', () => {
  it('announces each claim change after the store has made it', async () => {
    const log: string[] = [];
    const store = {
      openDraft: async () => {
        log.push('open');
        return { id: 'c1', duplicate: false };
      },
      assignPatient: async () => void log.push('patient'),
      saveClaim: async () => void log.push('save'),
      claimCheck: async () => null,
      patchClaim: async () => void log.push('patch'),
      setStatus: async () => {
        log.push('status');
        return 'stale' as const;
      },
      noteRevision: async () => {
        log.push('revision');
        return { status: 'draft' as const, previous: null };
      },
      attachCycle: async () => void log.push('attach'),
      statementData: async () => {
        throw new Error('not used');
      },
      saveStatement: async () => void log.push('statement'),
      ledger: async () => null,
      recordEvent: async () => void log.push('event'),
      closeClaim: async () => void log.push('close')
    } satisfies ClaimStore;
    const announced: [string, LiveEvent][] = [];
    const claims = announceClaims(store, async (runId, event) => {
      log.push('announce');
      announced.push([runId, event]);
    });
    assert.deepEqual(
      await claims.openDraft('r1', 'k', { pcrNumber: null, reportKey: null, claimId: null }),
      {
        id: 'c1',
        duplicate: false
      }
    );
    await claims.assignPatient('r1', 'c1', 'k', 'p1');
    await claims.saveClaim('r1', 'c1', 'k', {} as never);
    await claims.patchClaim('r1', 'c1', 'k', {} as never);
    assert.equal(await claims.setStatus('r1', 'c1', 'k', 'ready', 0), 'stale');
    assert.deepEqual(await claims.noteRevision('r1', 'c1', 'k', { bucket: 'b', key: 'k' }), {
      status: 'draft',
      previous: null
    });
    await claims.attachCycle('r1', 'c1', 'k', 'r2');
    await claims.recordEvent('r1', 'c1', 'k', {
      kind: 'follow_up',
      coverageId: null,
      note: '',
      payerClaimNumber: null
    });
    await claims.closeClaim('r1', 'c1', 'k', 'paid');
    assert.equal(await claims.ledger('r1', 'c1'), null);
    assert.equal(await claims.claimCheck('r1', 'c1'), null);
    assert.deepEqual(log, [
      'open',
      'announce',
      'patient',
      'announce',
      'save',
      'announce',
      'patch',
      'announce',
      'status',
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
