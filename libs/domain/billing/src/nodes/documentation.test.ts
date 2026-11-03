import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { invokeNode } from '@ugula/graph/testing';
import { documentationNodes } from './documentation.ts';

const [readSignature] = documentationNodes(() => {
  throw new Error('no stores');
});

describe('documentationNodes', () => {
  it('reads the release-for-billing signature from report signature groups', async () => {
    if (!readSignature) throw new Error('missing node');
    const result = await invokeNode(readSignature, {
      inputs: {
        signatures: [{ signer: '4512015', reasons: ['4513005'], status: '4515023' }]
      }
    });
    assert.deepEqual(result.outputs, {
      signature: 'exception',
      signatureNote: 'Not signed because the patient was unconscious'
    });
  });

  it('reports a missing release when the report has no signatures', async () => {
    if (!readSignature) throw new Error('missing node');
    assert.deepEqual((await invokeNode(readSignature)).outputs, {
      signature: 'missing',
      signatureNote: 'The report has no signature for the release for billing'
    });
  });
});
