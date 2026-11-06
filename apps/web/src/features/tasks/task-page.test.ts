import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import type { TaskClaim, TaskDetail, TasksClient } from './client.ts';
import type { Mismatch } from './encounter-check.ts';
import { headlineOf } from './task-brief.tsx';
import {
  backOfTask,
  fieldErrorsOf,
  NextUp,
  TaskAbout,
  TaskPage,
  type TaskTab,
  TaskView,
  taskTabOf
} from './task-page.tsx';

const task = (patch: Partial<TaskDetail> = {}): TaskDetail => ({
  id: 't1',
  run_id: 'r1',
  kind: 'task',
  queue: 'billing-review',
  title: 'Review PCR',
  subject: 'PCR-1 · Jane Doe',
  summary: null,
  priority: 0,
  due_at: null,
  permission: null,
  status: 'open',
  assignee_id: null,
  created_at: '2026-01-01T00:00:00Z',
  completed_at: null,
  instructions: 'Check the charges.',
  context: { suggested: { level: 'ALS1' } },
  fields: [{ name: 'note', type: 'string', label: 'Note' }],
  outcomes: ['approve', 'keepWaiting'],
  hints: {},
  defaults: { note: 'looks fine' },
  prefill: null,
  resolution: null,
  source: { reportId: null, pcrNumber: null, claim: null, patient: null },
  ...patch
});

const claimOf = (patch: Partial<TaskClaim> = {}): TaskClaim => ({
  id: 'c1',
  number: '20261101-0012',
  status: 'draft',
  patient: null,
  birthDate: null,
  serviceDate: null,
  classification: null,
  level: null,
  emergency: null,
  loadedMiles: null,
  totalCents: null,
  balanceCents: null,
  payers: [],
  lines: [],
  ...patch
});

const render = (
  t: TaskDetail,
  source: string | null = null,
  back = '/claims',
  tab: TaskTab = 'claim',
  mismatches: readonly Mismatch[] = [],
  claimView: string | null = null
) =>
  renderToStaticMarkup(
    createElement(TaskView, {
      task: t,
      back,
      remaining: 2,
      tab,
      tabHref: (to) => `/tasks/t1?tab=${to}`,
      mismatches,
      source,
      claimView,
      onComplete: async () => undefined,
      onAssign: async () => undefined,
      onNext: async () => undefined
    })
  );

describe('TaskView', () => {
  it('leads with the subject and queue, explains what to do and prefills the decision', () => {
    const html = render(task(), 'SOURCE PANEL');
    assert.ok(html.includes('PCR-1 · Jane Doe</h1>'));
    assert.ok(html.includes('Billing Review') && html.includes('Review PCR'));
    assert.ok(html.includes('The Issue') && html.includes('What&#x27;s Needed'));
    assert.ok(html.includes('Check the charges.'));
    assert.ok(!html.includes('ALS1'));
    assert.ok(render(task(), 'SOURCE PANEL', '/claims', 'workflow').includes('ALS1'));
    assert.ok(html.includes('value="looks fine"'));
    assert.ok(html.includes('>Approve<') && html.includes('>Keep Waiting<'));
    assert.ok(html.includes('value="approve"') && html.includes('name="outcome"'));
    assert.ok(html.includes('Assign to Me'));
    assert.ok(!html.includes('href="/runs/r1"'));
    assert.ok(html.includes('href="/claims"') && html.includes('Back to Claims'));
    assert.ok(!html.includes('SOURCE PANEL'));
    assert.ok(!html.includes('Open Claim'));
    assert.ok(render(task(), 'SOURCE PANEL', '/claims', 'encounter').includes('SOURCE PANEL'));
  });

  it('splits the data into Claim, Encounter and Patient tabs', () => {
    const patient = {
      id: 'p1',
      number: 'P-7',
      firstName: 'Jane',
      lastName: 'Doe',
      birthDate: '1950-02-03',
      sex: 'F',
      addressLine: '1 Main St',
      city: 'Harrisburg',
      state: 'PA',
      postalCode: '17101'
    };
    const t = task({ source: { reportId: null, pcrNumber: null, claim: claimOf(), patient } });
    const onClaim = render(t);
    assert.ok(onClaim.includes('href="/tasks/t1?tab=encounter"') && onClaim.includes('>Patient<'));
    assert.ok(onClaim.includes('aria-current="page"') && onClaim.includes('>Workflow<'));
    assert.ok(!onClaim.includes('Workflow Details'));
    const onPatient = render(t, null, '/claims', 'patient');
    assert.ok(
      onPatient.includes('Doe, Jane') && onPatient.includes('1 Main St, Harrisburg, PA 17101')
    );
    assert.ok(onPatient.includes('Female') && onPatient.includes('Patient P-7'));
    assert.ok(!onPatient.includes('Charges') && !onPatient.includes('Workflow Details'));
    const noReport = render(t, null, '/claims', 'encounter');
    assert.ok(noReport.includes('No patient care report is linked to this task.'));
    assert.ok(!render(task()).includes('Task data'));
  });

  it('shows the workflow context on its own tab, or as a panel when there are no tabs', () => {
    const t = task({
      source: { reportId: null, pcrNumber: null, claim: claimOf(), patient: null }
    });
    assert.ok(render(t, null, '/claims', 'workflow').includes('Workflow Details'));
    assert.ok(render(task()).includes('Workflow Details'));
    assert.ok(!render(task()).includes('Show Raw Data'));
  });

  it('shows the claim record on the Claim tab', () => {
    const t = task({
      source: { reportId: 'rep-1', pcrNumber: 'PCR-1', claim: claimOf(), patient: null }
    });
    assert.ok(render(t, 'SOURCE', '/claims', 'claim', [], 'CLAIM RECORD').includes('CLAIM RECORD'));
    assert.ok(render(t, 'SOURCE').includes('This task is not about a claim yet.'));
  });

  it("says what each option does in the workflow's words", () => {
    const html = render(
      task({
        outcomes: ['approve', 'fixData', 'continue'],
        hints: { fixData: 'Opens a Fix Claim Data task.' }
      })
    );
    assert.ok(
      html.includes('id="outcome-t1-fixData"') && html.includes('Opens a Fix Claim Data task.')
    );
    assert.ok(html.includes('aria-describedby="outcome-t1-fixData"'));
    assert.ok(!html.includes('id="outcome-t1-continue"'));
  });

  it('lists edits as current → new only when the fields hold current values', () => {
    const fields = [
      { name: 'memberId', type: 'string', label: 'Member ID' },
      { name: 'level', type: 'string', options: [{ value: 'BLS', label: 'Basic' }] }
    ] as TaskDetail['fields'];
    const defaults = { memberId: '1EG4', level: 'BLS' };
    const current = render(task({ fields, defaults, prefill: 'current' }));
    assert.ok(current.includes('Fields start with the current values'));
    assert.ok(current.includes('No Changes Yet'));
    const suggested = render(task({ fields, defaults, prefill: 'suggested' }));
    assert.ok(suggested.includes('Fields start with what the workflow suggests'));
    assert.ok(!suggested.includes('No Changes Yet'));
    assert.ok(!render(task({ fields, defaults })).includes('No Changes Yet'));
  });

  it('confirms cancel only on a stuck run', () => {
    const form = render(task({ outcomes: ['save', 'cancel'] }));
    assert.ok(!form.includes('border-danger/40'));
    const fault = render(task({ kind: 'fault', outcomes: ['retry', 'skip', 'cancel'] }));
    assert.ok(fault.includes('bg-danger'));
  });

  it('leads with the summary, else the first blocking issue, and shows the claim it is about', () => {
    const issues = [
      {
        code: 'msp',
        field: 'msp',
        message: 'Answer the MSP questions',
        coverageId: null,
        severity: 'warning'
      },
      {
        code: 'pcs',
        field: 'pcs',
        message: 'A PCS is needed',
        coverageId: null,
        severity: 'blocking'
      }
    ];
    assert.equal(headlineOf(task({ context: { issues } })), 'A PCS is needed');
    assert.equal(
      headlineOf(task({ summary: 'Medicare denied: CO-16', context: { issues } })),
      'Medicare denied: CO-16'
    );
    assert.equal(headlineOf(task()), 'Review PCR');
    const claim = claimOf({
      patient: 'Doe, Jane',
      serviceDate: '2026-09-14',
      classification: 'emergency',
      level: 'BLS',
      emergency: true,
      payers: [{ payer: 'Medicare', memberId: '1EG4', eligibility: 'active' }],
      lines: [{ code: 'A0429', units: 1, totalCents: 80000 }],
      balanceCents: 80000
    });
    const html = render(
      task({
        summary: 'Medicare denied: CO-16',
        source: { reportId: null, pcrNumber: null, claim, patient: null }
      })
    );
    assert.ok(html.includes('Medicare denied: CO-16</p>'));
    assert.ok(html.indexOf('The Issue') < html.indexOf('Your Decision'));
    assert.ok(html.indexOf('Your Decision') < html.indexOf('Task data'));
  });

  it('shows when a task is due and blocks completing it without its permission', () => {
    const html = render(task({ due_at: '2026-02-01T00:00:00Z', permission: 'claims:approve' }));
    assert.ok(html.includes('due <time dateTime="2026-02-01T00:00:00Z"'));
    assert.ok(html.includes('needs a role allowed to: Approve refunds'));
    assert.ok(!html.includes('claims:approve'));
  });

  it('links the claim a task is about as a reference, and goes back to the tasks', () => {
    const claim = claimOf();
    const onClaim = task({ source: { reportId: null, pcrNumber: 'PCR-1', claim, patient: null } });
    const html = render(onClaim);
    assert.ok(html.includes('Review PCR on claim <a'));
    assert.ok(html.includes('href="/claims/c1?back=%2Ftasks%2Ft1"'));
    assert.ok(html.includes('>20261101-0012</a> for a patient not matched yet, opened'));
    assert.ok(!html.includes('Open Claim'));
    assert.equal(backOfTask(null), '/tasks');
    assert.equal(backOfTask('/runs/r1'), '/runs/r1');
  });

  it('explains stuck-run resolutions and shows completed decisions', () => {
    const fault = render(
      task({
        kind: 'fault',
        queue: 'exceptions',
        subject: null,
        title: 'Stuck at Price',
        fields: [
          {
            name: 'pin',
            type: 'string',
            label: 'Continue from',
            options: [{ value: 'then', label: 'Then' }]
          },
          { name: 'outputs', type: { object: {} } }
        ],
        outcomes: ['retry', 'skip', 'cancel'],
        defaults: null,
        assignee_id: 'u1'
      })
    );
    assert.ok(fault.includes('Stuck at Price</h1>'));
    assert.ok(fault.includes('What Went Wrong'));
    assert.ok(fault.includes('Retry the failed step'));
    assert.ok(fault.includes('Unassign'));
    assert.ok(fault.includes('href="/runs/r1"') && fault.includes('Open Run'));
    assert.match(
      fault,
      /role="option"[^>]*aria-selected="false" data-value="then"[^>]*><span[^>]*>Then<\/span>/
    );
    const done = render(
      task({
        status: 'completed',
        completed_at: '2026-01-02T00:00:00Z',
        resolution: { outcome: 'keepWaiting', values: { note: 'ok' } }
      })
    );
    assert.ok(done.includes('as “Keep Waiting”'));
    assert.ok(!done.includes('>Approve<') && !done.includes('Assign to Me'));
    const cancelled = render(task({ status: 'cancelled' }));
    assert.ok(
      cancelled.includes('This task was cancelled.') && cancelled.includes('bg-warning/10')
    );
    assert.ok(!cancelled.includes('Assign to Me'));
  });

  it('marks required fields, blocks the outcomes that need them and themes destructive ones', () => {
    const html = render(
      task({
        title: 'Match payer',
        fields: [
          { name: 'payerId', type: 'string', label: 'Directory payer', required: ['link'] },
          { name: 'birthDate', type: 'string', label: 'Birth date', format: 'date' }
        ],
        outcomes: ['link', 'unlisted', 'void'],
        defaults: null
      })
    );
    assert.ok(html.includes('Directory Payer') && html.includes('required=""'));
    assert.ok(html.includes('type="date"'));
    assert.ok(html.includes('Fill in Directory Payer first.'));
    assert.ok(html.includes('>Link Payer<') && html.includes('>Mark Unlisted<'));
    assert.ok(html.includes('border-danger/40 text-danger'));
    assert.ok(html.includes('>Void<'));
  });
});

describe('fieldErrorsOf', () => {
  it('reads field errors from an invalid completion', () => {
    const err = Object.assign(new Error('Some fields are invalid'), {
      status: 422,
      body: { error: 'Some fields are invalid', fields: { payerId: 'is required', bad: 1 } }
    });
    assert.deepEqual(fieldErrorsOf(err), { payerId: 'is required' });
    assert.deepEqual(fieldErrorsOf(new Error('x')), {});
    const other = Object.assign(new Error('Conflict'), {
      status: 409,
      body: { fields: { payerId: 'is required' } }
    });
    assert.deepEqual(fieldErrorsOf(other), {});
    assert.deepEqual(fieldErrorsOf(Object.assign(new Error('x'), { status: 422, body: {} })), {});
  });
});

describe('NextUp', () => {
  const next = (remaining: number | null) =>
    renderToStaticMarkup(
      createElement(NextUp, {
        outcome: 'approve',
        queue: 'billing-review',
        remaining,
        back: '/claims?task=billing-review',
        onNext: async () => undefined
      })
    );

  it('confirms the decision and offers the next task only when there is one', () => {
    const more = next(2);
    assert.ok(more.includes('“Approve”'));
    assert.ok(more.includes('2 more tasks are waiting in Billing Review.'));
    assert.ok(more.includes('Next Task'));
    assert.ok(
      more.includes('href="/claims?task=billing-review"') && more.includes('Back to Claims')
    );
    const clear = next(0);
    assert.ok(clear.includes('Billing Review is clear.'));
    assert.ok(!clear.includes('Next Task'));
    assert.ok(next(1).includes('1 more task is waiting'));
    assert.ok(next(null).includes('Checking Billing Review'));
  });
});

describe('TaskPage', () => {
  it('shows a spinner while the task loads', () => {
    const html = renderToStaticMarkup(
      createElement(TaskPage, {
        client: {
          find: async () => task(),
          queues: async () => []
        } as unknown as TasksClient,
        live: idleLive,
        taskId: 't1',
        back: null
      })
    );
    assert.ok(html.includes('aria-label="Loading"') && !html.includes('<h1'));
  });
});

describe('TaskAbout', () => {
  it('says what a task is and which claim it is on in one sentence', () => {
    const claim = claimOf({ patient: 'Doe, Jane' });
    const text = (t: ReturnType<typeof task>) =>
      renderToStaticMarkup(createElement(TaskAbout, { task: t })).replace(/<[^>]+>/g, '');
    assert.equal(text(task()), 'Review PCR');
    assert.equal(
      text(
        task({ subject: null, source: { reportId: null, pcrNumber: null, claim, patient: null } })
      ),
      'On claim 20261101-0012 for Doe, Jane'
    );
    assert.equal(text(task({ subject: null })), 'Waiting on a decision');
  });
});

describe('TaskView files', () => {
  it('offers a file picker for a file field, uploading it for the task', () => {
    const html = renderToStaticMarkup(
      createElement(TaskView, {
        task: task({
          fields: [{ name: 'file', type: { object: { bucket: 'string', key: 'string' } } }],
          outcomes: ['add', 'cancel']
        }),
        back: '/claims',
        remaining: 0,
        upload: async () => ({ file: null, name: '' }),
        onComplete: async () => undefined,
        onAssign: async () => undefined,
        onNext: async () => undefined
      })
    );
    assert.ok(html.includes('type="file"') && html.includes('Choose a file to upload.'));
    assert.ok(html.includes('>Add Document<'));
  });
});

describe('taskTabOf', () => {
  it('opens the claim tab unless the URL names another', () => {
    assert.equal(taskTabOf(null), 'claim');
    assert.equal(taskTabOf('patient'), 'patient');
    assert.equal(taskTabOf('nope'), 'claim');
  });
});
