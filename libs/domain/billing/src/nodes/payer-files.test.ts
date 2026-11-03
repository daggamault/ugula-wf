import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { invokeNode } from '@ugula/graph/testing';
import { billingStores } from '../testing.ts';
import { payerFileNodes } from './payer-files.ts';
import type { AppliedPayerFile } from './stores.ts';

const file = { bucket: 'ugula', key: 'clearinghouse/t1/a.835' };

const applyWith = (result: AppliedPayerFile) => {
  const calls: unknown[] = [];
  const [node] = payerFileNodes(() =>
    billingStores({
      payerFiles: {
        apply: async (runId, key, f) => {
          calls.push([runId, key, f]);
          return result;
        }
      }
    })
  );
  if (!node) throw new Error('No apply node');
  return { node, calls };
};

describe('payerFileNodes', () => {
  it('applies a clearinghouse file and lists the lines a biller has to look at', async () => {
    const review = {
      reference: '1001',
      claimId: 'c1',
      outcome: 'review' as const,
      message: 'Reversal'
    };
    const { node, calls } = applyWith({
      status: 'applied',
      fileId: 'f1',
      kind: '835',
      reviews: [review]
    });
    const out = await invokeNode(node, { inputs: { file, fileName: 'a.835' } });
    assert.equal(out.pin, 'applied');
    assert.deepEqual(
      [out.outputs.fileId, out.outputs.kind, out.outputs.reviews],
      ['f1', '835', [review]]
    );
    assert.deepEqual((calls[0] as unknown[])[2], { document: file, fileName: 'a.835' });
  });

  it('continues through duplicate and unreadable files instead of faulting', async () => {
    const dup = await invokeNode(applyWith({ status: 'duplicate', fileId: 'f0' }).node, {
      inputs: { file, fileName: 'a.835' }
    });
    assert.deepEqual([dup.pin, dup.outputs.fileId, dup.outputs.reviews], ['duplicate', 'f0', []]);
    const bad = await invokeNode(applyWith({ status: 'unreadable', reason: 'Not X12' }).node, {
      inputs: { file, fileName: 'a.txt' }
    });
    assert.deepEqual([bad.pin, bad.outputs.reason], ['unreadable', 'Not X12']);
    await assert.rejects(
      () =>
        invokeNode(applyWith({ status: 'duplicate', fileId: 'f0' }).node, {
          inputs: { file: null, fileName: 'x' }
        }),
      /"file" of "Apply Payer File" is required/
    );
  });
});
