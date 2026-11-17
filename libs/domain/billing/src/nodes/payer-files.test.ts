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
  reversesPosted: false,
  status: '1',
  remarks: [],
  crossoverPayer: null,
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
  describe('read-payer-file', () => {
    it('reads an 835 into claim payments for the remittance rules, without applying it', async () => {
      const { node, calls } = nodesWith({ status: 'read', kind: '835', lines: [line] }, applied);
      const out = await invokeNode(node('read-payer-file'), {
        inputs: { file, fileName: 'a.835' }
      });
      assert.equal(out.pin, 'read');
      assert.deepEqual(out.outputs, { kind: '835', lines: [line], fileId: null, reason: null });
      assert.deepEqual(calls, [['read', 'run', { document: file, fileName: 'a.835' }]]);
    });

    it('continues through a file it already applied', async () => {
      const out = await invokeNode(
        nodesWith({ status: 'duplicate', fileId: 'f0' }, applied).node('read-payer-file'),
        { inputs: { file, fileName: 'a.835' } }
      );
      assert.equal(out.pin, 'duplicate');
      assert.deepEqual(out.outputs, { kind: null, lines: [], fileId: 'f0', reason: null });
    });

    it('continues through an unreadable file, saying why', async () => {
      const out = await invokeNode(
        nodesWith({ status: 'unreadable', reason: 'Not X12' }, applied).node('read-payer-file'),
        { inputs: { file, fileName: 'a.txt' } }
      );
      assert.equal(out.pin, 'unreadable');
      assert.deepEqual(out.outputs, { kind: null, lines: [], fileId: null, reason: 'Not X12' });
    });

    it('refuses a file without a storage key before reading anything', async () => {
      const { node, calls } = nodesWith({ status: 'duplicate', fileId: 'f0' }, applied);
      await assert.rejects(
        () =>
          invokeNode(node('read-payer-file'), {
            inputs: { file: { bucket: 'ugula' }, fileName: 'a.835' }
          }),
        { message: 'No payer file to apply' }
      );
      assert.deepEqual(calls, []);
    });
  });

  describe('apply-payer-file', () => {
    it('applies the file with the routed postings and lists the lines a biller has to look at', async () => {
      const { node, calls } = nodesWith({ status: 'read', kind: '835', lines: [line] }, applied);
      const posting = {
        position: 1,
        route: 'reconcile',
        message: '',
        adjustedCents: 200,
        crossover: true,
        reasons: []
      };
      const out = await invokeNode(node('apply-payer-file'), {
        inputs: { file, fileName: 'a.835', postings: [posting] }
      });
      assert.equal(out.pin, 'applied');
      assert.deepEqual(out.outputs, {
        fileId: 'f1',
        kind: '835',
        reviews: [review],
        envelopeRejection: null
      });
      assert.deepEqual(calls, [
        [
          'apply',
          'run',
          'key',
          {
            document: file,
            fileName: 'a.835',
            postings: [
              { position: 1, route: 'reconcile', message: '', adjustedCents: 200, crossover: true }
            ]
          }
        ]
      ]);
    });

    it('applies a file without postings and gives why a TA1 rejected it', async () => {
      const { node, calls } = nodesWith(
        { status: 'read', kind: 'TA1', lines: [] },
        { ...applied, kind: 'TA1', reviews: [], envelopeRejection: 'Invalid interchange sender ID' }
      );
      const out = await invokeNode(node('apply-payer-file'), {
        inputs: { file, fileName: 'a.ta1' }
      });
      assert.equal(out.pin, 'applied');
      assert.deepEqual(out.outputs, {
        fileId: 'f1',
        kind: 'TA1',
        reviews: [],
        envelopeRejection: 'Invalid interchange sender ID'
      });
      assert.deepEqual(calls, [
        ['apply', 'run', 'key', { document: file, fileName: 'a.ta1', postings: [] }]
      ]);
    });

    it('continues through a file another run applied first', async () => {
      const raced = nodesWith(
        { status: 'read', kind: '835', lines: [] },
        { status: 'duplicate', fileId: 'f0' }
      );
      const out = await invokeNode(raced.node('apply-payer-file'), {
        inputs: { file, fileName: 'a.835' }
      });
      assert.equal(out.pin, 'duplicate');
      assert.deepEqual(out.outputs, {
        fileId: 'f0',
        kind: null,
        reviews: [],
        envelopeRejection: null
      });
    });

    it('faults on a file it cannot read, since reading it first should have caught that', async () => {
      const garbled = nodesWith(
        { status: 'read', kind: '835', lines: [] },
        { status: 'unreadable', reason: 'Not an X12 file' }
      );
      await assert.rejects(
        () => invokeNode(garbled.node('apply-payer-file'), { inputs: { file, fileName: 'a.835' } }),
        { message: 'Not an X12 file' }
      );
    });

    it('refuses a file without a name before applying anything', async () => {
      const { node, calls } = nodesWith({ status: 'duplicate', fileId: 'f0' }, applied);
      await assert.rejects(
        () => invokeNode(node('apply-payer-file'), { inputs: { file, fileName: ' ' } }),
        { message: 'No payer file name' }
      );
      assert.deepEqual(calls, []);
    });
  });
});
