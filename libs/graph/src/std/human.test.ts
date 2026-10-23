import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { invokeNode } from '../testing.ts';
import { humanTaskNode } from './human.ts';

const config = {
  title: 'Review claim',
  queue: 'billing-review',
  fields: [{ name: 'reason', type: 'string', label: 'Reason', options: ['dup', 'wrong payer'] }],
  outcomes: ['approve', 'reject']
};

const reasonField = {
  name: 'reason',
  type: 'string',
  label: 'Reason',
  options: [
    { value: 'dup', label: 'dup' },
    { value: 'wrong payer', label: 'wrong payer' }
  ]
};

describe('human task node', () => {
  it('exposes outcomes as exec outputs and fields as outputs', async () => {
    const { signature, result } = await invokeNode(humanTaskNode, {
      config,
      inputs: { subject: 'Claim C1 · Jane Doe', context: { claimId: 'C1' }, priority: 2 }
    });
    assert.deepEqual(signature.execOut, ['approve', 'reject']);
    assert.deepEqual(
      signature.outputs.map((p) => p.name),
      ['reason', 'completedBy']
    );
    assert.equal(result.type, 'suspend');
    assert.deepEqual(result.type === 'suspend' && result.suspension, {
      kind: 'task',
      data: {
        title: 'Review claim',
        queue: 'billing-review',
        instructions: '',
        fields: [reasonField],
        outcomes: ['approve', 'reject'],
        subject: 'Claim C1 · Jane Doe',
        context: { claimId: 'C1' },
        defaults: null,
        assignee: null,
        priority: 2
      }
    });
  });

  it('continues through the chosen outcome with validated values', async () => {
    const resume = (payload: Record<string, unknown>) =>
      invokeNode(humanTaskNode, { config, event: { type: 'resume', payload: payload as never } });
    const done = await resume({ outcome: 'reject', values: { reason: 'dup' }, userId: 'u1' });
    assert.equal(done.pin, 'reject');
    assert.deepEqual(done.outputs, { reason: 'dup', completedBy: 'u1' });
    await assert.rejects(() => resume({ outcome: 'maybe' }), /Unknown task outcome/);
    await assert.rejects(
      () => resume({ outcome: 'reject', values: { reason: 'other' } }),
      /must be one of dup, wrong payer/
    );
    await assert.rejects(
      () => resume({ outcome: 'approve', values: { reason: 1 } }),
      /expected string/
    );
  });

  it('offers run-time options and validates the answer against them', async () => {
    const options = { reason: [{ value: 'p1', label: 'Doe, Jane' }, 'new'] };
    const { result } = await invokeNode(humanTaskNode, { config, inputs: { options } });
    const fields = [
      {
        ...reasonField,
        options: [
          { value: 'p1', label: 'Doe, Jane' },
          { value: 'new', label: 'new' }
        ]
      }
    ];
    assert.deepEqual(result.type === 'suspend' && result.suspension.data, {
      title: 'Review claim',
      queue: 'billing-review',
      instructions: '',
      fields,
      outcomes: ['approve', 'reject'],
      subject: null,
      context: null,
      defaults: null,
      assignee: null,
      priority: 0
    });
    assert.deepEqual(result.state, fields);
    const resume = (reason: string) =>
      invokeNode(humanTaskNode, {
        config,
        state: fields,
        event: { type: 'resume', payload: { outcome: 'approve', values: { reason } } }
      });
    assert.equal((await resume('p1')).outputs.reason, 'p1');
    await assert.rejects(() => resume('dup'), /must be one of p1, new/);
    await assert.rejects(
      () => invokeNode(humanTaskNode, { config, inputs: { options: { other: ['x'] } } }),
      /unknown field "other"/
    );
    await assert.rejects(
      () => invokeNode(humanTaskNode, { config, inputs: { options: { reason: [] } } }),
      /Task options/
    );
  });
});
