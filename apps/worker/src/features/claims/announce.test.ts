import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ClaimStore } from '@ugula/billing';
import { memoryClaims } from '@ugula/billing/testing';
import type { LiveEvent } from '@ugula/live';
import { announceClaims, announceClaimTasks } from './announce.ts';

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
      submission: async () => ({ submitter: null, pending: null }),
      sendClaimFile: async () => 'manual' as const,
      linkRun: async () => void log.push('link'),
      saveSubmission: async () => {
        log.push('submission');
        return 'stale' as const;
      },
      recordEvent: async () => void log.push('event'),
      closeClaim: async () => void log.push('close'),
      setResponsibility: async () => void log.push('responsibility'),
      facilityDirectory: async () => [],
      claimDocument: async () => null
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
    await claims.setResponsibility('r1', 'c1', 'k', {
      party: 'facility',
      facilityId: null,
      note: 'Contract'
    });
    assert.deepEqual(await claims.facilityDirectory('r1'), []);
    assert.equal(await claims.claimDocument('r1', 'c1', 'd1'), null);
    await claims.saveStatement('r1', 'c1', 'k', { number: 1, count: 3, pdf: new Uint8Array() });
    assert.equal(
      await claims.saveSubmission('r1', 'c1', 'k', {
        coverageId: 'cov-1',
        resubmission: false,
        totalCents: 0,
        production: false,
        build: () => ''
      }),
      'stale'
    );
    assert.equal(await claims.sendClaimFile('r1', 'c1', 1), 'manual');
    await claims.linkRun('r1', 'c1');
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
      'announce',
      'responsibility',
      'announce',
      'statement',
      'announce',
      'submission',
      'announce',
      'link'
    ]);
    assert.ok(
      announced.every(([runId, e]) => runId === 'r1' && e.kind === 'claim' && e.id === 'c1')
    );
  });

  it('announces nothing when the store refuses the change', async () => {
    const { store } = memoryClaims();
    let announced = 0;
    const claims = announceClaims(
      {
        ...store,
        closeClaim: async () => {
          throw new Error('Claim c9 does not exist');
        }
      },
      async () => void announced++
    );
    await assert.rejects(() => claims.closeClaim('r1', 'c9', 'k', 'paid'), /does not exist/);
    await claims.openDraft('r1', 'k', { pcrNumber: null, reportKey: null, claimId: 'c7' });
    assert.equal(announced, 1);
  });

  it('announces each claim a claim task changed', async () => {
    const announced: string[] = [];
    const tasks = announceClaimTasks(
      {
        setPayers: async () => ({ status: 'saved' }),
        postPayment: async () => ({ status: 'refused', reason: 'closed' }),
        addDocument: async () => ({ status: 'added', documentId: 'd1' })
      },
      async (runId, e) => void announced.push(`${runId}:${e.kind}:${e.id}`)
    );
    assert.deepEqual(await tasks.setPayers('r1', 'c1', []), { status: 'saved' });
    await tasks.postPayment('r1', 'c2', 'k', {} as never, null);
    await tasks.addDocument('r1', 'c3', 'k', {} as never);
    assert.deepEqual(announced, ['r1:claim:c1', 'r1:claim:c2', 'r1:claim:c3']);
  });
});
