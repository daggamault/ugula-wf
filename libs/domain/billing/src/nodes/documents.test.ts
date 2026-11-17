import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NodeDef } from '@ugula/graph';
import { invokeNode } from '@ugula/graph/testing';
import { billingStores } from '../testing.ts';
import { documentNodes } from './documents.ts';

describe('billing.document-chases', () => {
  it('gives each kind of document open chases are chasing once, ignoring unknown kinds', async () => {
    const asked: string[][] = [];
    const [node] = documentNodes(() =>
      billingStores({
        documents: {
          chasedDocuments: async (runId, claimId) => {
            asked.push([runId, claimId]);
            return ['signature', 'pcs', 'signature', 'unknown'];
          }
        }
      })
    );
    const out = await invokeNode(node as NodeDef, { inputs: { claimId: 'c1' } });
    assert.deepEqual(out.outputs, { chasing: ['pcs', 'signature'] });
    assert.deepEqual(asked, [['run', 'c1']]);
  });
});
