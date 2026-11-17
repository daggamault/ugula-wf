import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTRY_TYPE } from './compile.ts';
import { triggerSummary } from './core.ts';
import {
  type EventDef,
  type Trigger,
  triggerInputs,
  triggerIssues,
  triggerMatches,
  triggerOf
} from './triggers.ts';
import type { GraphDef, PinSpec } from './types.ts';

const received: EventDef = {
  type: 'file.received',
  label: 'File Received',
  description: 'A file arrived.',
  payload: [
    { name: 'fileId', type: { id: 'file' } },
    { name: 'kind', type: 'string' }
  ]
};

const workflow = (trigger: Trigger | undefined, inputs: PinSpec[] = []): GraphDef => ({
  signature: { execIn: ['exec'], execOut: ['then'], inputs, outputs: [] },
  variables: [],
  nodes: [
    { id: 'entry', type: ENTRY_TYPE, version: 1, ...(trigger ? { config: { trigger } } : {}) }
  ],
  edges: []
});

const onReceived = (where: Extract<Trigger, { kind: 'event' }>['where'] = {}): Trigger => ({
  kind: 'event',
  event: 'file.received',
  where
});

describe('triggerOf', () => {
  it('reads the trigger from the entry, and a workflow without one is run by hand', () => {
    assert.deepEqual(triggerOf(workflow(onReceived())), onReceived());
    assert.deepEqual(triggerOf(workflow(undefined)), { kind: 'manual' });
    assert.deepEqual(triggerOf(workflow({ kind: 'nope' } as never)), { kind: 'manual' });
  });
});

describe('triggerMatches', () => {
  it('matches its event when every condition holds on the payload', () => {
    const t = onReceived({ kind: { op: 'oneOf', value: ['835', '277'] } });
    assert.ok(triggerMatches(t, { type: 'file.received', payload: { kind: '835' } }));
    assert.ok(!triggerMatches(t, { type: 'file.received', payload: { kind: '999' } }));
    assert.ok(!triggerMatches(t, { type: 'file.sent', payload: { kind: '835' } }));
    assert.ok(!triggerMatches({ kind: 'manual' }, { type: 'file.received', payload: {} }));
  });
});

describe('triggerInputs', () => {
  it('passes the payload fields the workflow takes', () => {
    const sig = workflow(undefined, [{ name: 'fileId', type: 'string' }]).signature;
    assert.deepEqual(triggerInputs(sig, { fileId: 'f1', kind: '835' }), { fileId: 'f1' });
    assert.deepEqual(triggerInputs(sig, {}), {});
  });
});

describe('triggerIssues', () => {
  it('accepts inputs the event gives or that need no value', () => {
    const def = workflow(onReceived({ kind: { op: 'is', value: '835' } }), [
      { name: 'fileId', type: { id: 'file' } },
      { name: 'note', type: 'string', optional: true }
    ]);
    assert.deepEqual(triggerIssues(def, [received]), []);
    assert.deepEqual(triggerIssues(workflow(undefined, [{ name: 'x', type: 'string' }]), []), []);
  });

  it('names unknown events, untestable fields and inputs the event cannot fill', () => {
    assert.deepEqual(triggerIssues(workflow(onReceived()), []), ['Unknown event file.received']);
    const def = workflow(onReceived({ size: { op: 'gt', value: 0 } }), [
      { name: 'kind', type: 'integer' },
      { name: 'claimId', type: { id: 'claim' } }
    ]);
    assert.deepEqual(triggerIssues(def, [received]), [
      'File Received has no "size" to test',
      'Input "kind" is integer, but File Received gives string',
      'File Received gives no "claimId", so make it optional or give it a default'
    ]);
  });

  it('asks scheduled workflows for defaults and refuses graphs with no way in', () => {
    const daily: Trigger = { kind: 'schedule', every: 'day', hour: 6 };
    assert.deepEqual(
      triggerIssues(
        workflow(daily, [
          { name: 'days', type: 'integer', default: 30 },
          { name: 'payerId', type: 'string' }
        ]),
        []
      ),
      ['A scheduled workflow gets no inputs, so give "payerId" a default']
    );
    const rule = { ...workflow(daily), signature: { ...workflow(daily).signature, execIn: [] } };
    assert.deepEqual(triggerIssues(rule, []), ['Only a graph with a way in can start on its own']);
  });
});

describe('triggerSummary', () => {
  it('says when the workflow starts', () => {
    const label = (type: string) => (type === 'file.received' ? 'File Received' : type);
    assert.equal(triggerSummary({ kind: 'manual' }, label), null);
    assert.equal(triggerSummary(onReceived(), label), 'On File Received');
    assert.equal(
      triggerSummary(onReceived({ kind: { op: 'is', value: '835' } }), label),
      'On File Received (1 condition)'
    );
    assert.equal(
      triggerSummary({ kind: 'schedule', every: 'month', hour: 7 }, label),
      'On the first of every month at 07:00'
    );
    assert.equal(
      triggerSummary({ kind: 'schedule', every: 'week', hour: 18 }, label),
      'Every Monday at 18:00'
    );
  });
});
