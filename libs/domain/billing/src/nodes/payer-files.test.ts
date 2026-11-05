import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { invokeNode } from '@ugula/graph/testing';
import { billingStores } from '../testing.ts';
import { payerFileNodes } from './payer-files.ts';
import type { AppliedPayerFile, ReadPayerFile } from './stores.ts';

const file = { bucket: 'ugula', key: 'clearinghouse/t1/a.835' };

const line = {
  position: 1,
  reference: '1001',
  claimId: 'c1',
  coverageId: 'cov-1',
  payerName: 'Medicare',
  denied: false,
  reversal: false,
  takeback: false,
  paidCents: 800,
  adjustments: [{ group: 'CO' as const, reason: '45', cents: 200 }]
};

const nodesWith = (read: ReadPayerFile, applied: AppliedPayerFile) => {
  const calls: unknown[] = [];
  const nodes = payerFileNodes(() =>
    billingStores({
      payerFiles: {
        read: async (runId, f) => {
          calls.push(['read', runId, f]);
          return read;
        },
        apply: async (runId, key, f) => {
          calls.push(['apply', runId, key, f]);
          return applied;
        }
      }
    })
  );
  const node = (type: string) => {
    const found = nodes.find((n) => n.type === `billing.${type}`);
    if (!found) throw new Error(`No ${type} node`);
    return found;
  };
  return { node, calls };
};

const review = {
  reference: '1001',
  claimId: 'c1',
  outcome: 'review' as const,
  message: 'Reversal'
};

const applied: AppliedPayerFile = {
  status: 'applied',
  fileId: 'f1',
  kind: '835',
  reviews: [review],
  envelopeRejection: null
};

describe('payerFileNodes', () => {
  it('reads an 835 into claim payments for the remittance rules, without applying it', async () => {
    const { node, calls } = nodesWith({ status: 'read', kind: '835', lines: [line] }, applied);
    const out = await invokeNode(node('read-payer-file'), { inputs: { file, fileName: 'a.835' } });
    assert.deepEqual([out.pin, out.outputs.kind, out.outputs.lines], ['read', '835', [line]]);
    assert.deepEqual(calls, [['read', 'run', { document: file, fileName: 'a.835' }]]);
  });

  it('continues through duplicate and unreadable files instead of faulting', async () => {
    const dup = await invokeNode(
      nodesWith({ status: 'duplicate', fileId: 'f0' }, applied).node('read-payer-file'),
      { inputs: { file, fileName: 'a.835' } }
    );
    assert.deepEqual([dup.pin, dup.outputs.fileId, dup.outputs.lines], ['duplicate', 'f0', []]);
    const bad = await invokeNode(
      nodesWith({ status: 'unreadable', reason: 'Not X12' }, applied).node('read-payer-file'),
      { inputs: { file, fileName: 'a.txt' } }
    );
    assert.deepEqual([bad.pin, bad.outputs.reason], ['unreadable', 'Not X12']);
  });

  it('applies the file with the routed postings and lists the lines a biller has to look at', async () => {
    const { node, calls } = nodesWith({ status: 'read', kind: '835', lines: [line] }, applied);
    const posting = {
      position: 1,
      route: 'reconcile',
      message: '',
      adjustedCents: 200,
      reasons: []
    };
    const out = await invokeNode(node('apply-payer-file'), {
      inputs: { file, fileName: 'a.835', postings: [posting] }
    });
    assert.equal(out.pin, 'applied');
    assert.deepEqual(
      [out.outputs.fileId, out.outputs.kind, out.outputs.reviews],
      ['f1', '835', [review]]
    );
    assert.deepEqual((calls[0] as unknown[])[3], {
      document: file,
      fileName: 'a.835',
      postings: [{ position: 1, route: 'reconcile', message: '', adjustedCents: 200 }]
    });
    const raced = nodesWith(
      { status: 'read', kind: '835', lines: [] },
      { status: 'duplicate', fileId: 'f0' }
    );
    const dup = await invokeNode(raced.node('apply-payer-file'), {
      inputs: { file, fileName: 'a.835' }
    });
    assert.deepEqual([dup.pin, dup.outputs.fileId], ['duplicate', 'f0']);
  });

  it('refuses a file without a storage key or a name before reading anything', async () => {
    const { node, calls } = nodesWith({ status: 'duplicate', fileId: 'f0' }, applied);
    await assert.rejects(
      () =>
        invokeNode(node('read-payer-file'), {
          inputs: { file: { bucket: 'ugula' }, fileName: 'a.835' }
        }),
      /No payer file to apply/
    );
    await assert.rejects(
      () => invokeNode(node('apply-payer-file'), { inputs: { file, fileName: ' ' } }),
      /No payer file name/
    );
    assert.deepEqual(calls, []);
  });
});
