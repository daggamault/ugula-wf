import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LiveEvent } from '@ugula/live';
import { createElement } from 'react';
import type { Live } from '../../shared/live.ts';
import { idleLive } from '../../shared/testing.ts';
import { render, screen, waitFor } from '../../shared/testing-dom.ts';
import type { ToastInput } from '../../shared/ui/toast.tsx';
import type { QueueSummary, TasksClient } from './client.ts';
import { newWork, useWorkAlerts, workToast } from './work-alerts.ts';

const q = (queue: string, open: number): QueueSummary => ({
  queue,
  open,
  unassigned: open,
  mine: 0,
  oldest: ''
});

describe('newWork', () => {
  it('reports nothing on the first look', () => {
    assert.deepEqual(newWork(undefined, [q('billing-review', 3)]), []);
  });

  it('reports queues that grew since the last look, including new queues', () => {
    assert.deepEqual(
      newWork(
        [q('billing-review', 3), q('exceptions', 1)],
        [q('billing-review', 5), q('exceptions', 0), q('billing-payers', 1)]
      ),
      [
        { queue: 'billing-review', added: 2 },
        { queue: 'billing-payers', added: 1 }
      ]
    );
  });

  it('reports nothing when no queue grew', () => {
    assert.deepEqual(newWork([q('billing-review', 3)], [q('billing-review', 3)]), []);
  });
});

describe('workToast', () => {
  it('says what arrived where, replaces older news for the queue and links to it', () => {
    assert.deepEqual(workToast({ queue: 'billing-review', added: 2 }), {
      key: 'new-work:billing-review',
      isRecorded: false,
      intent: 'info',
      title: '2 new tasks in Billing Review',
      action: { label: 'Open Billing Review', to: '/tasks?queue=billing-review' }
    });
  });

  it('counts a single task and names unknown queues from their key', () => {
    assert.equal(workToast({ queue: 'exceptions', added: 1 }).title, '1 new task in Stuck Runs');
    assert.deepEqual(workToast({ queue: 'my queue', added: 1 }).action, {
      label: 'Open My Queue',
      to: '/tasks?queue=my%20queue'
    });
  });
});

describe('useWorkAlerts', () => {
  const setup = (answers: QueueSummary[][], quiet = false) => {
    const listeners: ((e: LiveEvent | null) => void)[] = [];
    const live: Live = {
      ...idleLive,
      subscribe: (listener) => {
        listeners.push(listener);
        return () => undefined;
      }
    };
    let loads = 0;
    const client = {
      queues: async () => answers[Math.min(loads++, answers.length - 1)] ?? []
    } as unknown as TasksClient;
    const toasts: ToastInput[] = [];
    const notify = (t: ToastInput) => void toasts.push(t);
    const Harness = ({ isQuiet }: { isQuiet: boolean }) =>
      createElement('output', null, String(useWorkAlerts(client, live, notify, isQuiet)));
    const { rerender } = render(createElement(Harness, { isQuiet: quiet }));
    const emit = (e: LiveEvent) => {
      for (const listener of listeners) listener(e);
    };
    return {
      toasts,
      emit,
      loads: () => loads,
      setQuiet: (isQuiet: boolean) => rerender(createElement(Harness, { isQuiet }))
    };
  };

  const count = () => screen.getByRole('status').textContent;

  it('counts the open tasks across queues without alerting on the first load', async () => {
    const { toasts } = setup([[q('billing-review', 3), q('exceptions', 2)]]);
    await waitFor(() => assert.equal(count(), '5'));
    assert.deepEqual(toasts, []);
  });

  it('alerts about the new work found after a task changes', async () => {
    const { toasts, emit, loads } = setup([
      [q('billing-review', 3)],
      [q('billing-review', 4), q('exceptions', 1)]
    ]);
    await waitFor(() => assert.equal(count(), '3'));
    emit({ kind: 'task', id: 't1', runId: null });
    await waitFor(() =>
      assert.deepEqual(
        toasts.map((t) => t.title),
        ['1 new task in Billing Review', '1 new task in Stuck Runs']
      )
    );
    assert.equal(count(), '5');
    assert.equal(loads(), 2);
  });

  it('does not reload for events about other things', async () => {
    const { emit, loads } = setup([[q('billing-review', 3)]]);
    await waitFor(() => assert.equal(count(), '3'));
    emit({ kind: 'claim', id: 'c1' });
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(loads(), 1);
  });

  it('stays quiet while asked and does not replay that work afterwards', async () => {
    const { toasts, emit, setQuiet } = setup(
      [[q('billing-review', 3)], [q('billing-review', 6)]],
      true
    );
    await waitFor(() => assert.equal(count(), '3'));
    emit({ kind: 'task', id: 't1', runId: null });
    await waitFor(() => assert.equal(count(), '6'));
    setQuiet(false);
    assert.deepEqual(toasts, []);
  });
});
