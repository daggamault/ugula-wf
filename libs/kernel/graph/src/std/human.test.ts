import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { invokeNode } from '../testing.ts';
import { createHumanTaskNode } from './human.ts';

const humanTaskNode = createHumanTaskNode(['claims:approve', 'claims:update']);

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
      config: { ...config, permission: 'claims:approve' },
      inputs: {
        subject: 'Claim C1 · Jane Doe',
        summary: 'Medicare needs a PCS',
        context: { claimId: 'C1' },
        priority: 2,
        due: '2026-12-01T00:00:00.000Z'
      }
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
        summary: 'Medicare needs a PCS',
        context: { claimId: 'C1' },
        defaults: null,
        assignee: null,
        priority: 2,
        due: '2026-12-01T00:00:00.000Z',
        permission: 'claims:approve'
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
    assert.deepEqual((await resume({ outcome: 'approve', userId: 7 })).outputs, {
      reason: null,
      completedBy: null
    });
    await assert.rejects(
      () => invokeNode(humanTaskNode, { event: { type: 'resume', payload: null }, config }),
      /Unknown task outcome ""/
    );
  });

  it('rejects tasks without unique identifier outcomes or a permission name', async () => {
    for (const outcomes of [[], ['ok', 'ok'], ['not ok']])
      await assert.rejects(() => invokeNode(humanTaskNode, { config: { ...config, outcomes } }));
    await assert.rejects(() =>
      invokeNode(humanTaskNode, { config: { ...config, permission: 'approve' } })
    );
  });

  it('accepts only permissions the catalog knows, any well-formed one without a list', async () => {
    await assert.rejects(
      () => invokeNode(humanTaskNode, { config: { ...config, permission: 'claims:approv' } }),
      /Unknown permission/
    );
    const { result } = await invokeNode(humanTaskNode, {
      config: { ...config, permission: 'claims:approve' }
    });
    assert.equal(
      result.type === 'suspend' && (result.suspension.data as { permission: string }).permission,
      'claims:approve'
    );
    await invokeNode(createHumanTaskNode(), { config: { ...config, permission: 'x:y' } });
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
      summary: null,
      context: null,
      defaults: null,
      assignee: null,
      priority: 0,
      due: null,
      permission: null
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

  it('asks only the visible fields and requires them for the outcomes that need them', async () => {
    const fix = {
      title: 'Fix claim data',
      queue: 'billing-review',
      fields: [
        { name: 'serviceDate', type: 'string', format: 'date', required: ['save'] },
        { name: 'loadedMiles', type: 'number', min: 0.1 }
      ],
      outcomes: ['save', 'void']
    };
    const { result } = await invokeNode(humanTaskNode, {
      config: fix,
      inputs: { visible: ['serviceDate'] }
    });
    const asked = result.type === 'suspend' ? result.state : null;
    assert.deepEqual(asked, [fix.fields[0]]);
    const resume = (outcome: string, values: Record<string, unknown>) =>
      invokeNode(humanTaskNode, {
        config: fix,
        state: asked,
        event: { type: 'resume', payload: { outcome, values } as never }
      });
    assert.deepEqual(
      (await resume('save', { serviceDate: '2026-09-30', loadedMiles: 3 })).outputs,
      { serviceDate: '2026-09-30', loadedMiles: null, completedBy: null }
    );
    assert.equal((await resume('void', {})).pin, 'void');
    await assert.rejects(() => resume('save', {}), /"serviceDate": is required/);
    await assert.rejects(
      () => resume('save', { serviceDate: '2026-13-01' }),
      /must be a date \(YYYY-MM-DD\)/
    );
  });
});
