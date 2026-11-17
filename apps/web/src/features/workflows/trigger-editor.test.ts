import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { EventDef, GraphDef, Json } from '@ugula/graph';
import { createElement, useState } from 'react';
import { createCatalog } from '../../shared/graph/catalog.ts';
import { WorkflowEventsContext } from '../../shared/graph/pins.ts';
import { testNodes } from '../../shared/testing.ts';
import { render, screen, userEvent, within } from '../../shared/testing-dom.ts';
import { startOf, TriggerEditor, testsOf, whereOf } from './trigger-editor.tsx';

const EVENTS: EventDef[] = [
  {
    type: 'claim.denied',
    label: 'Claim Denied',
    description: 'A payer denied a claim on a remittance.',
    payload: [
      { name: 'claimId', type: { id: 'claim' }, label: 'Claim' },
      { name: 'route', type: 'string', label: 'Route' }
    ]
  },
  { type: 'claim.paid', label: 'Claim Paid', description: 'A claim was paid.', payload: [] }
];

const def: GraphDef = {
  signature: { execIn: ['exec'], execOut: [], inputs: [], outputs: [] },
  variables: [],
  nodes: [],
  edges: []
};

const Harness = ({ initial, sent }: { initial: Json | undefined; sent: (Json | undefined)[] }) => {
  const [config, setConfig] = useState<Json | undefined>(initial);
  return createElement(
    WorkflowEventsContext.Provider,
    { value: EVENTS },
    createElement(TriggerEditor, {
      nodeId: 'entry',
      config,
      editable: true,
      onConfig: (next) => {
        sent.push(next);
        setConfig(next);
      },
      def,
      catalog: createCatalog(testNodes)
    })
  );
};

const show = (initial?: Json) => {
  const sent: (Json | undefined)[] = [];
  render(createElement(Harness, { initial, sent }));
  return { last: () => sent.at(-1), user: userEvent.setup() };
};

const pick = async (user: ReturnType<typeof userEvent.setup>, list: string, name: string) =>
  user.click(within(screen.getByRole('listbox', { name: list })).getByRole('option', { name }));

const shown = (name: string) => screen.getByRole('button', { name }).textContent;

describe('trigger helpers', () => {
  it('turns the conditions of an event trigger into rows and back', () => {
    const where = { route: { op: 'is' as const, value: 'appeal' } };
    assert.deepEqual(testsOf(where), [{ field: 'route', op: 'is', value: 'appeal' }]);
    assert.deepEqual(whereOf(testsOf(where)), where);
  });

  it('starts each kind of trigger from sensible defaults', () => {
    assert.deepEqual(startOf('manual', EVENTS), { kind: 'manual' });
    assert.deepEqual(startOf('event', EVENTS), { kind: 'event', event: 'claim.denied', where: {} });
    assert.deepEqual(startOf('schedule', EVENTS), { kind: 'schedule', every: 'day', hour: 6 });
  });
});

describe('TriggerEditor', () => {
  it('runs by hand until another start is chosen', () => {
    show();
    assert.equal(shown('Starts'), 'When Someone Runs It');
    assert.equal(screen.queryByRole('button', { name: 'Event' }), null);
  });

  it('starts on an event, says what the event is and tests its fields', async () => {
    const { last, user } = show();
    await pick(user, 'Starts', 'When an Event Happens');
    assert.deepEqual(last(), { trigger: { kind: 'event', event: 'claim.denied', where: {} } });
    const event = screen.getByRole('button', { name: 'Event' });
    assert.equal(event.textContent, 'Claim Denied');
    assert.equal(
      document.getElementById(event.getAttribute('aria-describedby') ?? '')?.textContent,
      'A payer denied a claim on a remittance.'
    );
    await user.click(screen.getByRole('button', { name: 'Add Condition' }));
    assert.deepEqual(last(), {
      trigger: { kind: 'event', event: 'claim.denied', where: { claimId: { op: 'is' } } }
    });
    await pick(user, 'Field', 'Route');
    await user.type(screen.getByRole('textbox', { name: 'Value' }), 'appeal');
    assert.deepEqual(last(), {
      trigger: {
        kind: 'event',
        event: 'claim.denied',
        where: { route: { op: 'is', value: 'appeal' } }
      }
    });
    await pick(user, 'Event', 'Claim Paid');
    assert.deepEqual(last(), { trigger: { kind: 'event', event: 'claim.paid', where: {} } });
  });

  it('runs on a schedule at an hour of the agency day', async () => {
    const { last, user } = show({ trigger: { kind: 'schedule', every: 'day', hour: 6 } });
    assert.equal(shown('Repeats'), 'Every Day');
    assert.equal(shown('At'), '06:00');
    await pick(user, 'Repeats', 'On the First of Every Month');
    await pick(user, 'At', '07:00');
    assert.deepEqual(last(), { trigger: { kind: 'schedule', every: 'month', hour: 7 } });
  });
});
