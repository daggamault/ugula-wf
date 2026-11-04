import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTRY_TYPE } from './compile.ts';
import { documentationIssues, isTitleCase } from './documentation.ts';
import type { GraphDef } from './types.ts';

const graph = (over: Partial<GraphDef['signature']>, label?: string): GraphDef => ({
  signature: { execIn: ['exec'], execOut: [], inputs: [], outputs: [], ...over },
  variables: [],
  nodes: [{ id: 'entry', type: ENTRY_TYPE, version: 1, ...(label ? { label } : {}) }],
  edges: []
});

describe('isTitleCase', () => {
  it('accepts Title Case with minor words, codes and symbols', () => {
    for (const label of [
      'Trip Type',
      'Level of Service',
      'Base Rate · ePayment.50',
      'IV/IO Medications',
      'Treat, No Transport',
      '837P File',
      'Of Course'
    ]) {
      assert.equal(isTitleCase(label), true, label);
    }
  });

  it('rejects lowercase words that are not minor words', () => {
    for (const label of ['Trip type', 'level of Service', 'Destination minus Scene', 'of Course']) {
      assert.equal(isTitleCase(label), false, label);
    }
  });
});

describe('documentationIssues', () => {
  it('passes a fully documented graph', () => {
    const def = graph(
      {
        execOut: ['approved'],
        inputs: [{ name: 'claim', type: 'any', label: 'Claim', description: 'The claim.' }],
        outputs: [{ name: 'code', type: 'string', description: 'The HCPCS code.' }],
        exits: { approved: { label: 'Approved' } }
      },
      'Start Here'
    );
    assert.deepEqual(documentationIssues(def), []);
  });

  it('lists undescribed pins, undocumented exits and labels not in Title Case', () => {
    const def = graph(
      {
        execOut: ['then', 'voided'],
        inputs: [{ name: 'claim', type: 'any', label: 'the claim' }],
        outputs: [{ name: 'code', type: 'string', description: '  ' }],
        exits: { voided: { label: 'voided claim', description: 'Voided.' } }
      },
      'start here'
    );
    assert.deepEqual(documentationIssues(def), [
      { message: 'Describe the input "claim"' },
      { message: 'Write the input label "the claim" in Title Case' },
      { message: 'Describe the output "code"' },
      { message: 'Label or describe the exit "then"' },
      { message: 'Write the exit label "voided claim" in Title Case' },
      { node: 'entry', message: 'Write the label "start here" in Title Case' }
    ]);
  });
});
