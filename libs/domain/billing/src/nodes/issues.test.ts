import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { invokeNode } from '@ugula/graph/testing';
import { issueNodes } from './issues.ts';

const [issueWhen, issueForEach] = issueNodes(() => {
  throw new Error('no stores');
});

const run = async (inputs: Record<string, unknown>) => {
  if (!issueWhen) throw new Error('missing');
  return invokeNode(issueWhen, {
    inputs: inputs as never,
    config: { code: 'pcs-missing', field: 'pcs', message: 'The certification is missing' }
  });
};

describe('issue nodes', () => {
  it('raises the issue only when its condition holds', async () => {
    assert.deepEqual((await run({ when: true })).outputs.issue, {
      code: 'pcs-missing',
      severity: null,
      field: 'pcs',
      message: 'The certification is missing',
      coverageId: null
    });
    assert.equal((await run({ when: false })).outputs.issue, null);
  });

  it('raises one issue for each item, naming it', async () => {
    if (!issueForEach) throw new Error('missing');
    const { outputs } = await invokeNode(issueForEach, {
      inputs: { items: ['city', 'state'] },
      config: {
        code: 'pickup-address-missing',
        field: 'pickup',
        message: 'The pickup {item} is missing'
      }
    });
    assert.deepEqual(
      (outputs.issues as { message: string }[]).map((i) => i.message),
      ['The pickup city is missing', 'The pickup state is missing']
    );
    const none = await invokeNode(issueForEach, { config: { code: 'x' } });
    assert.deepEqual(none.outputs.issues, []);
    const off = await invokeNode(issueForEach, {
      inputs: { when: false, items: ['city'] },
      config: { code: 'x' }
    });
    assert.deepEqual(off.outputs.issues, []);
  });

  it('takes a message and payer from the claim', async () => {
    const { outputs } = await run({ when: true, message: 'Signed 70 days ago', coverageId: 'c1' });
    assert.deepEqual(
      [
        (outputs.issue as { message: string }).message,
        (outputs.issue as { coverageId: string }).coverageId
      ],
      ['Signed 70 days ago', 'c1']
    );
  });
});
