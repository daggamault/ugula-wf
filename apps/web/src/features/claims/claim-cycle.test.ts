import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import type { ClaimDetail, ClaimTask } from '../../shared/claims/claim-detail.ts';
import { claimDetail } from '../../shared/claims/testing.ts';
import { formatAgo } from '../../shared/format.ts';
import { render, screen, within } from '../../shared/testing-dom.ts';
import { CycleAlert, describeCycle, describeProgress, OpenTasks } from './claim-cycle.tsx';
import type { ClaimProgress } from './client.ts';

const medicare = { id: 'cov-m', payer: 'Medicare', claimFiling: null };

const waiting: ClaimProgress = { step: 'await', coverage: medicare, waitMs: 1, balanceCents: 1 };

describe('describeProgress', () => {
  it('tells billers what each step of the claim cycle is doing', () => {
    const steps: ClaimProgress[] = [
      { step: 'review', coverage: medicare, balanceCents: 1 },
      { step: 'submit', coverage: medicare, balanceCents: 1 },
      { step: 'reconcile', coverage: medicare, balanceCents: 1 },
      { step: 'workDenial', coverage: medicare, balanceCents: 1 },
      waiting,
      { step: 'followUp', coverage: medicare, balanceCents: 1 },
      { step: 'reviewPatient', balanceCents: 1 },
      { step: 'confirmPayers', balanceCents: 1 },
      { step: 'overpaid', balanceCents: -2_500 },
      { step: 'statement', statement: 2, balanceCents: 1 },
      { step: 'awaitPatient', waitMs: 1, balanceCents: 1 },
      { step: 'awaitReview', waitMs: 1, balanceCents: -1 },
      { step: 'facility', waitMs: 1, balanceCents: 1 },
      { step: 'followUpFacility', balanceCents: 1 },
      { step: 'collections', balanceCents: 1 },
      { step: 'writeOff', balanceCents: 1 },
      { step: 'closed', balanceCents: 0 }
    ];
    assert.deepEqual(Object.fromEntries(steps.map((p) => [p.step, describeProgress(p)])), {
      review:
        'Needs review before it goes to Medicare. Check the claim, then approve its review task. Its 837P file is created as soon as it is approved.',
      submit:
        'Approved. Creating its 837P file for Medicare; a task opens if it cannot be created.',
      reconcile: 'Medicare answered and a balance remains. A reconcile task is waiting.',
      workDenial:
        'Medicare denied the claim. A denial decision, correction or appeal is being worked.',
      await:
        'Waiting on Medicare. A follow-up task opens if they have not answered 30 days after submission.',
      followUp: 'Medicare has not answered in 30 days. A payer follow-up task is waiting.',
      reviewPatient: 'Every payer is done. A review task is waiting before the patient is billed.',
      confirmPayers:
        'No payer is on this claim. A task is waiting to add one or confirm the patient pays.',
      overpaid: '$25.00 more has been paid than the claim charges. A refund task is waiting.',
      statement: 'Sending patient statement 2 of 3.',
      awaitPatient:
        'Waiting on the patient. The next statement goes out 30 days after the last one.',
      awaitReview:
        'A payer file line on this claim waits for a biller, so the credit balance is not refunded yet.',
      facility:
        'A facility is responsible for this trip. It is billed on the monthly facility invoice, and a follow-up task opens if it has not paid 60 days after.',
      followUpFacility:
        'The responsible facility has not paid in time. A facility follow-up task is waiting.',
      collections:
        'Every payer and patient statement is done. A balance review task is waiting for a decision.',
      writeOff: 'The balance left is within what the agency writes off. Closing as written off.',
      closed: 'Paid in full. Closing.'
    });
  });
});

describe('describeCycle', () => {
  it('describes nothing for a closed claim', () => {
    for (const status of ['paid', 'written_off', 'collections', 'void'] as const)
      assert.equal(describeCycle({ status, cycle_status: 'completed' }, waiting), null);
  });

  it('says a draft is still being worked into a claim', () => {
    assert.deepEqual(describeCycle({ status: 'draft', cycle_status: null }, null), {
      stopped: false,
      restartable: false,
      intent: 'info',
      text: 'Draft. Its PCR is still being worked into a claim.'
    });
  });

  it('warns that a claim without a cycle can be restarted', () => {
    assert.deepEqual(describeCycle({ status: 'ready', cycle_status: null }, waiting), {
      stopped: true,
      intent: 'warning',
      text: 'No payer cycle is running for this claim.',
      restartable: true
    });
  });

  it('reports a failed or cancelled cycle as stopped until restarted', () => {
    assert.deepEqual(describeCycle({ status: 'submitted', cycle_status: 'failed' }, waiting), {
      stopped: true,
      intent: 'danger',
      text: 'The payer cycle failed, so nothing more will happen on this claim until it is restarted.',
      restartable: true
    });
    assert.deepEqual(describeCycle({ status: 'submitted', cycle_status: 'cancelled' }, waiting), {
      stopped: true,
      intent: 'danger',
      text: 'The payer cycle was cancelled, so nothing more will happen on this claim until it is restarted.',
      restartable: true
    });
  });

  it('points a faulted cycle at its stuck run task rather than a restart', () => {
    assert.deepEqual(describeCycle({ status: 'submitted', cycle_status: 'faulted' }, waiting), {
      stopped: true,
      intent: 'danger',
      text: 'The payer cycle hit an error. A stuck run task is waiting for a decision.',
      restartable: false
    });
  });

  it('describes the next step of a live cycle', () => {
    for (const cycle_status of ['running', 'suspended', 'completed'] as const)
      assert.deepEqual(describeCycle({ status: 'submitted', cycle_status }, waiting), {
        intent: 'info',
        text: describeProgress(waiting),
        stopped: false,
        restartable: false
      });
  });

  it('warns about an overpaid claim', () => {
    assert.equal(
      describeCycle(
        { status: 'reconcile', cycle_status: 'running' },
        { step: 'overpaid', balanceCents: -1 }
      )?.intent,
      'warning'
    );
  });

  it('describes nothing for a live cycle whose step is unknown', () => {
    assert.equal(describeCycle({ status: 'submitted', cycle_status: 'running' }, null), null);
  });
});

const showAlert = (over: Partial<ClaimDetail>, progress: ClaimProgress | null = waiting) =>
  render(createElement(CycleAlert, { claim: { ...claimDetail, ...over }, progress }));

describe('CycleAlert', () => {
  it('shows what the live cycle is doing without linking its run', () => {
    showAlert({ cycle_status: 'suspended' });
    assert.equal(screen.getByRole('status').textContent, describeProgress(waiting));
    assert.ok(!screen.queryByRole('link'));
  });

  it('asks to restart a stopped cycle and opens its run', () => {
    showAlert({ cycle_status: 'failed', cycle_run_id: 'cycle-1' });
    const alert = screen.getByRole('alert');
    assert.equal(
      alert.textContent,
      'The payer cycle failed, so nothing more will happen on this claim until it is restarted. Restart it from Start Task.Open Cycle Run'
    );
    assert.equal(
      within(alert).getByRole('link', { name: 'Open Cycle Run' }).getAttribute('href'),
      '/runs/cycle-1'
    );
  });

  it('links no run for a claim that never had a cycle', () => {
    showAlert({ status: 'ready', cycle_status: null, cycle_run_id: null }, null);
    assert.equal(
      screen.getByRole('status').textContent,
      'No payer cycle is running for this claim. Restart it from Start Task.'
    );
    assert.ok(!screen.queryByRole('link'));
  });

  it('shows nothing for a closed claim', () => {
    const { container } = showAlert({ status: 'paid', cycle_status: 'completed' }, null);
    assert.equal(container.innerHTML, '');
  });
});

const task: ClaimTask = {
  id: 't1',
  title: 'Confirm patient',
  subject: null,
  queue: 'billing-patients',
  kind: 'task',
  assignee_id: 'u1',
  assignee_email: 'me@example.com',
  due_at: null,
  created_at: '2026-10-01T00:00:00Z'
};

describe('OpenTasks', () => {
  it('lists each open task with its queue, assignee and age, to work it', () => {
    render(
      createElement(OpenTasks, {
        tasks: [task, { ...task, id: 't2', title: 'Fix payer', assignee_email: 'kim@x.com' }],
        back: '/claims/c1',
        me: 'me@example.com'
      })
    );
    const opened = formatAgo(task.created_at);
    assert.deepEqual(
      screen.getAllByRole('status').map((s) => s.textContent),
      [
        `Confirm patientPatient Matching · You · opened ${opened}Work Task`,
        `Fix payerPatient Matching · kim@x.com · opened ${opened}Work Task`
      ]
    );
    assert.deepEqual(
      screen.getAllByRole('link', { name: 'Work Task' }).map((a) => a.getAttribute('href')),
      ['/tasks/t1?back=%2Fclaims%2Fc1', '/tasks/t2?back=%2Fclaims%2Fc1']
    );
  });

  it('raises a stuck run task as an alert', () => {
    render(
      createElement(OpenTasks, {
        tasks: [{ ...task, kind: 'fault', assignee_email: null }],
        back: '',
        me: 'me@example.com'
      })
    );
    assert.equal(
      within(screen.getByRole('alert')).getByText(/Unassigned/).textContent,
      `Patient Matching · Unassigned · opened ${formatAgo(task.created_at)}`
    );
  });
});
