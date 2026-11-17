import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { ENTRY_TYPE } from './compile.ts';
import { actionNode, branchNode, defineNode, next, pin, pureNode } from './define.ts';
import {
  documentationIssues,
  isTitleCase,
  nameLabel,
  nodeDocumentationIssues,
  pathLabel
} from './documentation.ts';
import type { ExitDoc, GraphDef } from './types.ts';

const graph = (over: Partial<GraphDef['signature']>, label?: string): GraphDef => ({
  signature: { execIn: ['exec'], execOut: [], inputs: [], outputs: [], ...over },
  variables: [],
  nodes: [{ id: 'entry', type: ENTRY_TYPE, version: 1, ...(label ? { label } : {}) }],
  edges: []
});

describe('isTitleCase', () => {
  it('accepts Title Case with minor words, codes and symbols', () => {
    for (const label of [
      'Classification',
      'Level of Service',
      'Base Rate · ePayment.50',
      'IV/IO Medications',
      'Treat, No Transport',
      '837P File',
      'Of Course',
      'Follow-Up',
      '  Spaced  Out  '
    ]) {
      assert.equal(isTitleCase(label), true, label);
    }
  });

  it('rejects lowercase words that are not minor words', () => {
    for (const label of [
      'Loaded miles',
      'level of Service',
      'Destination minus Scene',
      'of Course',
      'Follow-up',
      'Pick/drop'
    ]) {
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

describe('nodeDocumentationIssues', () => {
  const base = {
    title: 'Grade',
    category: 'T',
    description: 'Grades a score.',
    inputs: [pin('score', 'number', { description: 'The score.' })],
    outputs: [pin('margin', 'number', { label: 'Margin', description: 'How far off.' })]
  };
  const compute = () => ({ exit: 'pass' as const, outputs: {} });

  it('passes a node whose pins and exits are documented', () => {
    const grade = branchNode({
      ...base,
      type: 't.grade',
      exits: { pass: { label: 'Pass' }, fail: { description: 'Below half.' } },
      compute
    });
    assert.deepEqual(nodeDocumentationIssues(grade), []);
    const act = actionNode({ ...base, type: 't.act', compute: () => ({}) });
    assert.deepEqual(nodeDocumentationIssues(act), []);
  });

  it('lists undescribed pins and undocumented exits other than then, leaving label case to the editor', () => {
    const grade = branchNode({
      ...base,
      type: 't.grade',
      inputs: [pin('score', 'number')],
      outputs: [pin('margin', 'number', { label: 'the margin', description: 'How far off.' })],
      exits: { pass: { label: 'pass' }, fail: {} },
      compute
    });
    assert.deepEqual(nodeDocumentationIssues(grade), [
      { node: 't.grade', message: 'Describe the input "score"' },
      { node: 't.grade', message: 'Write the exit label "pass" in Title Case' },
      { node: 't.grade', message: 'Label or describe the exit "fail"' }
    ]);
  });

  it('checks a configurable node as first placed, and only its exits when it needs settings', () => {
    const counted = pureNode<{ count: number }>({
      ...base,
      type: 't.counted',
      config: v.object({ count: v.optional(v.number(), 1) }),
      outputs: ({ count }) => Array.from({ length: count }, (_, i) => pin(`out${i}`, 'number')),
      compute: () => ({})
    });
    assert.deepEqual(nodeDocumentationIssues(counted), [
      { node: 't.counted', message: 'Describe the output "out0"' }
    ]);
    const named = defineNode<{ name: string }>({
      type: 't.named',
      version: 1,
      title: 'Named',
      category: 'T',
      description: 'Needs a name.',
      config: v.object({ name: v.string() }),
      exits: { found: {} },
      signature: ({ name }) => ({
        execIn: [],
        execOut: [],
        inputs: [pin(name, 'any')],
        outputs: []
      }),
      run: () => next(null)
    });
    assert.deepEqual(nodeDocumentationIssues(named), [
      { node: 't.named', message: 'Label or describe the exit "found"' }
    ]);
  });

  it('checks only the exits of a node whose signature cannot be worked out unplaced', () => {
    const wired = (exits?: Record<string, ExitDoc>) =>
      defineNode({
        type: 't.wired',
        version: 1,
        title: 'Wired',
        category: 'T',
        description: 'Needs a graph.',
        ...(exits ? { exits } : {}),
        signature: () => {
          throw new Error('needs a graph');
        },
        run: () => next(null)
      });
    assert.deepEqual(nodeDocumentationIssues(wired({ done: { label: 'Done' }, failed: {} })), [
      { node: 't.wired', message: 'Label or describe the exit "failed"' }
    ]);
    assert.deepEqual(nodeDocumentationIssues(wired()), []);
  });
});

describe('labels from names', () => {
  it('splits camelCase, acronyms, underscores and hyphens into capitalised words', () => {
    assert.deepEqual(
      ['claimId', 'HCPCSCode', 'ICD10Codes', 'base_rate', 'loaded-miles', 'a', ''].map(nameLabel),
      ['Claim Id', 'HCPCS Code', 'ICD10 Codes', 'Base Rate', 'Loaded Miles', 'A', '']
    );
  });

  it('labels each step of a dotted path', () => {
    assert.equal(pathLabel('patient.homeAddress.zip'), 'Patient › Home Address › Zip');
    assert.equal(pathLabel('total'), 'Total');
  });
});
