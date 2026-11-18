import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { AccessProvider } from '../../shared/access.tsx';
import type { Live } from '../../shared/live.ts';
import { idleLive } from '../../shared/testing.ts';
import { render, screen, userEvent, waitFor, within } from '../../shared/testing-dom.ts';
import { type ToastInput, ToastProvider } from '../../shared/ui/toast.tsx';
import type { TaskDetail, TasksClient } from './client.ts';
import {
  backOfTask,
  fieldErrorsOf,
  isCodeField,
  NextUp,
  TaskPage,
  TaskView
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
  ...patch
});

type ViewProps = Parameters<typeof TaskView>[0];

const showView = (t: TaskDetail, props: Partial<ViewProps> = {}) => {
  const completed: unknown[][] = [];
  render(
    createElement(TaskView, {
      task: t,
      back: '/claims',
      remaining: 2,
      onComplete: async (...args) => {
        completed.push(args);
      },
      onAssign: async () => undefined,
      onNext: async () => undefined,
      ...props
    })
  );
  return { completed, user: userEvent.setup() };
};

const isBefore = (a: Element, b: Element) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('TaskView header', () => {
  it('titles the page by the subject and says which queue and task it is', () => {
    showView(task());
    screen.getByRole('heading', { level: 1, name: 'PCR-1 · Jane Doe' });
    screen.getByText('Billing Review');
    screen.getByText(/^Review PCR, opened/);
  });

  it('titles the page by the task when there is no subject', () => {
    showView(task({ subject: null }));
    screen.getByRole('heading', { level: 1, name: 'Review PCR' });
  });

  it('goes back with a label for where the task was opened from', () => {
    showView(task());
    assert.equal(
      screen.getByRole('link', { name: 'Back to Claims' }).getAttribute('href'),
      '/claims'
    );
  });

  it('shows when the task was opened and when it is due', () => {
    showView(task({ due_at: '2026-02-01T00:00:00Z' }));
    const times = [...document.querySelectorAll('time')].map((t) => t.getAttribute('datetime'));
    assert.deepEqual(times, ['2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z']);
    assert.ok(document.querySelector('h1')?.nextElementSibling?.textContent?.includes(', due '));
  });

  it('shows no due date when there is none', () => {
    showView(task());
    assert.equal(document.querySelectorAll('time').length, 1);
  });

  it('offers to assign an open, unassigned task', () => {
    showView(task());
    screen.getByRole('button', { name: 'Assign to Me' });
    assert.ok(!screen.queryByRole('button', { name: 'Unassign' }));
    assert.ok(!screen.queryByRole('link', { name: 'Open Run' }));
  });

  it('offers to hand back an assigned task', () => {
    showView(task({ assignee_id: 'u1' }));
    screen.getByRole('button', { name: 'Unassign' });
    assert.ok(!screen.queryByRole('button', { name: 'Assign to Me' }));
  });

  it('says when a background refresh failed and keeps the task form', () => {
    showView(task(), { refreshError: 'Network down' });
    assert.equal(screen.getByRole('alert').textContent, 'Network down');
    screen.getByRole('list', { name: 'Options' });
  });
});

describe('TaskView issue', () => {
  it('explains the issue and what is needed', () => {
    showView(task());
    const issue = screen.getByRole('region', { name: 'The Issue' });
    within(issue).getByRole('heading', { name: "What's Needed" });
    within(issue).getByText('Check the charges.');
  });

  it('leads with the summary, ahead of the decision and the workflow details', () => {
    showView(task({ summary: 'Medicare denied: CO-16' }));
    const issue = screen.getByRole('region', { name: 'The Issue' });
    within(issue).getByText('Medicare denied: CO-16');
    const decision = screen.getByRole('region', { name: 'Your Decision' });
    const details = screen.getByRole('region', { name: 'Workflow Details' });
    assert.ok(isBefore(issue.querySelector('h2') as Element, decision));
    assert.ok(isBefore(decision, details));
  });
});

describe('TaskView decision', () => {
  it('prefills the fields from the defaults', () => {
    showView(task());
    assert.equal(
      screen.getByRole<HTMLInputElement>('textbox', { name: 'Note' }).value,
      'looks fine'
    );
  });

  it('offers each outcome as a named option, the first one solid', () => {
    showView(task());
    const options = within(screen.getByRole('list', { name: 'Options' })).getAllByRole('button');
    assert.deepEqual(
      options.map((b) => [b.textContent, b.getAttribute('name'), b.getAttribute('value')]),
      [
        ['Approve', 'outcome', 'approve'],
        ['Keep Waiting', 'outcome', 'keepWaiting']
      ]
    );
    assert.ok(options[0]?.classList.contains('bg-primary'));
    assert.ok(!options[1]?.classList.contains('bg-primary'));
  });

  it("describes each option in the workflow's words, else the usual words, else not at all", () => {
    showView(
      task({
        outcomes: ['fixData', 'keepWaiting', 'continue'],
        hints: { fixData: 'Opens a Fix Claim Data task.' }
      })
    );
    screen.getByRole('button', {
      name: 'Fix Claim Data',
      description: 'Opens a Fix Claim Data task.'
    });
    screen.getByRole('button', {
      name: 'Keep Waiting',
      description: 'Waits longer for an answer; this task comes back if none arrives.'
    });
    assert.equal(
      screen.getByRole('button', { name: 'Continue' }).getAttribute('aria-describedby'),
      null
    );
  });

  it('records the chosen outcome with the field values', async () => {
    const { completed, user } = showView(task());
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    assert.deepEqual(completed, [['approve', { note: 'looks fine' }, '']]);
  });

  it('sends the note with the decision', async () => {
    const { completed, user } = showView(task());
    await user.type(screen.getByRole('textbox', { name: 'Note (Optional)' }), ' Called the crew ');
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    assert.deepEqual(completed, [['approve', { note: 'looks fine' }, 'Called the crew']]);
  });

  it('starts fields without a default blank', () => {
    showView(task({ defaults: null }));
    assert.equal(screen.getByRole<HTMLInputElement>('textbox', { name: 'Note' }).value, '');
  });

  it('marks required fields and blocks the outcomes that need them until filled', () => {
    showView(
      task({
        fields: [
          { name: 'payerId', type: 'string', label: 'Directory payer', required: ['link'] },
          { name: 'birthDate', type: 'string', label: 'Birth date', format: 'date' }
        ],
        outcomes: ['link', 'unlisted', 'void'],
        defaults: null
      })
    );
    assert.equal(
      screen.getByRole<HTMLInputElement>('textbox', { name: 'Directory Payer' }).required,
      true
    );
    assert.equal(screen.getByLabelText<HTMLInputElement>('Birth Date').type, 'date');
    const link = screen.getByRole('button', {
      name: 'Link Payer',
      description: 'Fill in Directory Payer first.'
    });
    assert.equal(link.getAttribute('aria-disabled'), 'true');
    assert.equal(
      screen.getByRole('button', { name: 'Mark Unlisted' }).getAttribute('aria-disabled'),
      null
    );
  });

  it('themes destructive options as danger and asks before them', async () => {
    const { completed, user } = showView(task({ outcomes: ['approve', 'void'] }));
    const voiding = screen.getByRole('button', { name: 'Void' });
    assert.ok(voiding.classList.contains('text-danger'));
    await user.click(voiding);
    const dialog = screen.getByRole('dialog', { name: 'Void?' });
    within(dialog).getByRole('button', { name: 'Keep' });
    assert.deepEqual(completed, []);
  });

  it('blocks completing without the permission the task needs, saying which', () => {
    showView(task({ permission: 'payers:update' }));
    const approve = screen.getByRole('button', {
      name: 'Approve',
      description: /^Completing this task needs a role allowed to: Change payers/
    });
    assert.equal(approve.getAttribute('aria-disabled'), 'true');
    assert.ok(!document.body.textContent?.includes('payers:update'));
  });

  it('lets a user with the permission complete the task', async () => {
    const completed: unknown[][] = [];
    render(
      createElement(AccessProvider, {
        access: {
          agencyId: 'a1',
          agencyName: 'Agency',
          organizationId: 'o1',
          organizationName: 'Org',
          userId: 'u1',
          isOrganizationAdmin: false,
          permissions: ['payers:update']
        },
        children: createElement(TaskView, {
          task: task({ permission: 'payers:update' }),
          back: '/claims',
          remaining: 0,
          onComplete: async (...args) => {
            completed.push(args);
          },
          onAssign: async () => undefined,
          onNext: async () => undefined
        })
      })
    );
    const approve = screen.getByRole('button', { name: 'Approve' });
    assert.equal(approve.getAttribute('aria-disabled'), null);
    await userEvent.setup().click(approve);
    assert.deepEqual(completed, [['approve', { note: 'looks fine' }, '']]);
  });
});

describe('TaskView changes', () => {
  const fields = [
    { name: 'memberId', type: 'string', label: 'Member ID' },
    { name: 'level', type: 'string', options: [{ value: 'BLS', label: 'Basic' }] }
  ] as TaskDetail['fields'];
  const defaults = { memberId: '1EG4', level: 'BLS' };

  it('lists edits as current → new when the fields hold current values', () => {
    showView(task({ fields, defaults, prefill: 'current' }));
    screen.getByText(/^Fields start with the current values\./);
    within(screen.getByRole('region', { name: 'Your Changes' })).getByRole('heading', {
      name: 'No Changes Yet'
    });
  });

  it('lists an edit and undoes it', async () => {
    const { user } = showView(task({ fields, defaults, prefill: 'current' }));
    const member = screen.getByRole<HTMLInputElement>('textbox', { name: 'Member ID' });
    await user.type(member, 'X');
    const changes = screen.getByRole('region', { name: 'Your Changes' });
    assert.equal(
      within(changes).getByRole('listitem').textContent,
      'Member IDCurrent: 1EG4New: 1EG4X'
    );
    await user.click(screen.getByRole('button', { name: 'Undo change to Member ID' }));
    assert.equal(member.value, '1EG4');
    within(changes).getByRole('heading', { name: 'No Changes Yet' });
  });

  it('says the fields hold suggestions without listing changes', () => {
    showView(task({ fields, defaults, prefill: 'suggested' }));
    screen.getByText(/^Fields start with what the workflow suggests\./);
    assert.ok(!screen.queryByRole('region', { name: 'Your Changes' }));
  });

  it('gives no field help without a prefill', () => {
    showView(task({ fields, defaults }));
    assert.ok(!screen.queryByText(/^Fields start with/));
    assert.ok(!screen.queryByRole('region', { name: 'Your Changes' }));
  });
});

describe('TaskView stuck runs', () => {
  const fault = task({
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
  });

  it('explains what went wrong and how each resolution works', () => {
    showView(fault);
    screen.getByRole('heading', { level: 1, name: 'Stuck at Price' });
    screen.getByRole('region', { name: 'What Went Wrong' });
    screen.getByText(/^Retry the failed step, skip it with the outputs below/);
  });

  it('links to the run', () => {
    showView(fault);
    assert.equal(screen.getByRole('link', { name: 'Open Run' }).getAttribute('href'), '/runs/r1');
  });

  it('offers the exec pin to continue from, with nothing chosen', () => {
    showView(fault);
    assert.equal(screen.getByRole('button', { name: 'Continue From' }).textContent, 'Choose…');
    assert.equal(
      screen.getByRole('option', { name: 'Then', hidden: true }).getAttribute('aria-selected'),
      'false'
    );
  });

  it('themes retry as primary, skip as a warning and cancel as danger, all solid', () => {
    showView(fault);
    const classesOf = (name: string) => screen.getByRole('button', { name }).classList;
    assert.ok(classesOf('Retry').contains('bg-primary'));
    assert.ok(classesOf('Skip').contains('bg-warning'));
    assert.ok(classesOf('Cancel').contains('bg-danger'));
  });
});

describe('TaskView closed tasks', () => {
  it('shows how a completed task was decided, with the values recorded', () => {
    showView(
      task({
        status: 'completed',
        completed_at: '2026-01-02T00:00:00Z',
        resolution: { outcome: 'keepWaiting', values: { note: 'ok' } }
      })
    );
    const decision = screen.getByRole('region', { name: 'Decision' });
    within(decision).getByText(/as “Keep Waiting”\.$/);
    within(decision).getByText('ok');
    assert.ok(!screen.queryByRole('button', { name: 'Approve' }));
    assert.ok(!screen.queryByRole('button', { name: 'Assign to Me' }));
  });

  it('warns that a task was cancelled', () => {
    showView(task({ status: 'cancelled' }));
    const alert = screen.getByText('This task was cancelled.');
    assert.ok(alert.closest('[class*="bg-warning/10"]'));
    assert.ok(!screen.queryByRole('button', { name: 'Assign to Me' }));
    assert.ok(!screen.queryByRole('list', { name: 'Options' }));
  });
});

describe('TaskView files', () => {
  it('offers a file picker for a file field, uploading it for the task', async () => {
    const sent: string[] = [];
    const { user } = showView(
      task({
        fields: [{ name: 'file', type: { object: { bucket: 'string', key: 'string' } } }],
        outcomes: ['add', 'cancel']
      }),
      {
        upload: async (f) => {
          sent.push(f.name);
          return { file: { bucket: 'b', key: 'k' }, name: f.name };
        }
      }
    );
    const picker = screen.getByLabelText<HTMLInputElement>('File');
    assert.equal(picker.type, 'file');
    screen.getByRole('button', { name: 'Add Document' });
    await user.upload(picker, new File(['%PDF'], 'pcs.pdf', { type: 'application/pdf' }));
    await screen.findByText('Uploaded pcs.pdf');
    assert.deepEqual(sent, ['pcs.pdf']);
  });
});

describe('isCodeField', () => {
  it('picks codes for text or text list fields naming a known code set', () => {
    assert.ok(isCodeField({ name: 'd', type: { list: 'string' }, codeSet: 'icd10cm' }));
    assert.ok(isCodeField({ name: 'd', type: 'string', codeSet: 'hcpcs' }));
  });

  it('does not pick codes for an unknown code set, a non-text field or no code set', () => {
    assert.ok(!isCodeField({ name: 'd', type: 'string', codeSet: 'cpt' }));
    assert.ok(!isCodeField({ name: 'd', type: 'integer', codeSet: 'icd10cm' }));
    assert.ok(!isCodeField({ name: 'd', type: { list: 'integer' }, codeSet: 'icd10cm' }));
    assert.ok(!isCodeField({ name: 'd', type: 'string' }));
  });
});

describe('TaskView codes', () => {
  const codeTask = task({
    fields: [
      {
        name: 'diagnoses',
        type: { list: 'string' },
        label: 'ICD-10 diagnoses, primary first',
        codeSet: 'icd10cm'
      }
    ],
    outcomes: ['save', 'cancel']
  });

  it('offers a code search for a field that picks from a code set', () => {
    showView(codeTask, {
      codes: { search: async () => [], describe: async () => [], describeKind: async () => [] }
    });
    assert.equal(screen.getAllByRole('combobox').length, 1);
    assert.ok(!screen.queryByText('One per line.'));
  });

  it('falls back to plain lines without a code client', () => {
    showView(codeTask);
    assert.equal(screen.queryAllByRole('combobox').length, 0);
    screen.getByText('One per line.');
  });
});

describe('fieldErrorsOf', () => {
  const invalid = (status: number, body: object) =>
    Object.assign(new Error('Some fields are invalid'), { status, body });

  it('reads the text field errors of an invalid completion', () => {
    assert.deepEqual(fieldErrorsOf(invalid(422, { fields: { payerId: 'is required', bad: 1 } })), {
      payerId: 'is required'
    });
  });

  it('reads nothing from other failures', () => {
    assert.deepEqual(fieldErrorsOf(new Error('x')), {});
    assert.deepEqual(fieldErrorsOf(invalid(409, { fields: { payerId: 'is required' } })), {});
    assert.deepEqual(fieldErrorsOf('offline'), {});
  });

  it('reads nothing from an invalid completion without field errors', () => {
    assert.deepEqual(fieldErrorsOf(invalid(422, {})), {});
    assert.deepEqual(fieldErrorsOf(invalid(422, { fields: null })), {});
  });
});

describe('NextUp', () => {
  const showNext = (remaining: number | null, onNext = async () => undefined) => {
    render(
      createElement(NextUp, {
        outcome: 'approve',
        queue: 'billing-review',
        remaining,
        back: '/claims?task=billing-review',
        onNext
      })
    );
    return { user: userEvent.setup() };
  };

  it('confirms the decision', () => {
    showNext(2);
    within(screen.getByRole('region', { name: 'Done' })).getByText(
      /“Approve” is recorded and the workflow continues\./
    );
  });

  it('offers the next task, focused, when more are waiting', () => {
    showNext(2);
    screen.getByText('2 more tasks are waiting in Billing Review.');
    assert.ok(document.activeElement === screen.getByRole('button', { name: 'Next Task' }));
  });

  it('counts a single waiting task', () => {
    showNext(1);
    screen.getByText('1 more task is waiting in Billing Review.');
  });

  it('says the queue is clear and offers no next task', () => {
    showNext(0);
    screen.getByText('Billing Review is clear.');
    assert.ok(!screen.queryByRole('button', { name: 'Next Task' }));
  });

  it('says it is still checking the queue', () => {
    showNext(null);
    screen.getByText('Checking Billing Review…');
    assert.ok(!screen.queryByRole('button', { name: 'Next Task' }));
  });

  it('goes back to where the task was opened from', () => {
    showNext(0);
    assert.equal(
      screen.getByRole('link', { name: 'Back to Claims' }).getAttribute('href'),
      '/claims?task=billing-review'
    );
  });

  it('opens the next task', async () => {
    const asked: string[] = [];
    const { user } = showNext(2, async () => {
      asked.push('next');
    });
    await user.click(screen.getByRole('button', { name: 'Next Task' }));
    assert.deepEqual(asked, ['next']);
  });
});

describe('TaskPage', () => {
  it('shows a spinner while the task loads', () => {
    render(
      createElement(TaskPage, {
        client: {
          find: () => new Promise(() => undefined),
          queues: async () => []
        } as unknown as TasksClient,
        codes: { search: async () => [], describe: async () => [], describeKind: async () => [] },
        live: idleLive,
        taskId: 't1',
        back: null
      })
    );
    screen.getByRole('status', { name: 'Loading' });
    assert.ok(!screen.queryByRole('heading', { level: 1 }));
  });
});

describe('backOfTask', () => {
  it('goes back to the tasks unless told where the task was opened from', () => {
    assert.equal(backOfTask(null), '/tasks');
    assert.equal(backOfTask('/runs/r1'), '/runs/r1');
  });
});

const queue = { queue: 'billing-review', open: 3, unassigned: 2, mine: 0, oldest: '' };

const fakeClient = (over: Partial<TasksClient> = {}) => {
  const calls: unknown[][] = [];
  const client = {
    find: async () => task({ outcomes: ['approve', 'void'] }),
    queues: async () => [queue],
    followUp: async () => null,
    complete: async (...args: unknown[]) => {
      calls.push(['complete', ...args]);
      return { status: 'completed' };
    },
    assign: async (id: string) => {
      calls.push(['assign', id]);
      return { status: 'assigned' };
    },
    unassign: async (id: string) => {
      calls.push(['unassign', id]);
      return { status: 'released' };
    },
    next: async (q: string | null) => {
      calls.push(['next', q]);
      return task({ id: 't2' });
    },
    ...over
  } as unknown as TasksClient;
  return { client, calls };
};

const openTask = async (
  client: TasksClient,
  { back = null, live = idleLive }: { back?: string | null; live?: Live } = {}
) => {
  const toasts: ToastInput[] = [];
  render(
    createElement(
      ToastProvider,
      { onNotify: (t) => toasts.push(t) },
      createElement(TaskPage, {
        client,
        codes: { search: async () => [], describe: async () => [], describeKind: async () => [] },
        live,
        taskId: 't1',
        back
      })
    )
  );
  await screen.findByRole('heading', { level: 1 });
  return { toasts, user: userEvent.setup() };
};

describe('TaskPage working a task', () => {
  it('records the chosen outcome with the edited fields and says what is left in the queue', async () => {
    const { client, calls } = fakeClient();
    const { toasts, user } = await openTask(client);
    const note = screen.getByRole('textbox', { name: 'Note' });
    await user.clear(note);
    await user.type(note, 'fixed the level');
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await screen.findByRole('heading', { name: 'Done' });
    assert.deepEqual(calls, [['complete', 't1', 'approve', { note: 'fixed the level' }, '']]);
    assert.deepEqual(toasts, [
      { title: 'Approve: PCR-1 · Jane Doe', description: 'Recorded in Billing Review.' }
    ]);
    assert.ok(screen.getByText('2 more tasks are waiting in Billing Review.'));
    assert.ok(!screen.queryByRole('button', { name: 'Assign to Me' }));
    assert.ok(document.activeElement === screen.getByRole('button', { name: 'Next Task' }));
  });

  it('opens the next task in the queue, keeping the way back to the list', async () => {
    const { client, calls } = fakeClient();
    const { user } = await openTask(client, { back: '/tasks?queue=billing-review' });
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await user.click(await screen.findByRole('button', { name: 'Next Task' }));
    await waitFor(() =>
      assert.equal(
        `${window.location.pathname}${window.location.search}`,
        '/tasks/t2?back=%2Ftasks%3Fqueue%3Dbilling-review'
      )
    );
    assert.deepEqual(calls.at(-1), ['next', 'billing-review']);
  });

  it('goes back when another worker already took the last task in the queue', async () => {
    const { client } = fakeClient({ next: async () => null });
    const { user } = await openTask(client, { back: '/runs/r1' });
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await user.click(await screen.findByRole('button', { name: 'Next Task' }));
    await waitFor(() => assert.equal(window.location.pathname, '/runs/r1'));
  });

  it('says when the next task could not be opened and stays on the page', async () => {
    const { client } = fakeClient({
      next: async () => {
        throw new Error('Network down');
      }
    });
    const { toasts, user } = await openTask(client);
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    const next = await screen.findByRole('button', { name: 'Next Task' });
    await user.click(next);
    await waitFor(() =>
      assert.deepEqual(toasts.at(-1), {
        intent: 'danger',
        title: 'Could not open the next task',
        description: 'Network down'
      })
    );
    assert.equal(window.location.pathname, '/');
    await waitFor(() => assert.equal(next.getAttribute('aria-busy'), null));
  });

  it('offers the follow-up task the workflow opened on the same run', async () => {
    const asked: unknown[][] = [];
    const { client } = fakeClient({
      followUp: async (runId: string, after: string) => {
        asked.push([runId, after]);
        return { id: 't3', title: 'Post Payment', subject: null };
      }
    });
    const { user } = await openTask(client, { back: '/claims/c1' });
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    const link = await screen.findByRole('link', { name: 'Open Post Payment' });
    assert.equal(link.getAttribute('href'), '/tasks/t3?back=%2Fclaims%2Fc1');
    assert.deepEqual(asked, [['r1', 't1']]);
  });

  it('asks before a destructive outcome and records nothing when the user keeps the claim', async () => {
    const { client, calls } = fakeClient();
    const { user } = await openTask(client);
    await user.click(screen.getByRole('button', { name: 'Void' }));
    const dialog = screen.getByRole('dialog', { name: 'Void?' });
    assert.ok(within(dialog).getByText(/This cannot be undone\./));
    await user.click(within(dialog).getByRole('button', { name: 'Keep' }));
    assert.ok(!screen.queryByRole('dialog'));
    assert.deepEqual(calls, []);
    await user.click(screen.getByRole('button', { name: 'Void' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Void' }));
    await screen.findByRole('heading', { name: 'Done' });
    assert.deepEqual(calls, [['complete', 't1', 'void', { note: 'looks fine' }, '']]);
  });

  it('cancels an ordinary task without asking', async () => {
    const { client, calls } = fakeClient({
      find: async () => task({ outcomes: ['save', 'cancel'] })
    });
    const { user } = await openTask(client);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await screen.findByRole('heading', { name: 'Done' });
    assert.deepEqual(calls, [['complete', 't1', 'cancel', { note: 'looks fine' }, '']]);
  });

  it('confirms cancelling a stuck run before it ends the run', async () => {
    const { client, calls } = fakeClient({
      find: async () =>
        task({ kind: 'fault', queue: 'exceptions', fields: [], outcomes: ['retry', 'cancel'] })
    });
    const { user } = await openTask(client);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    const dialog = screen.getByRole('dialog', { name: 'Cancel?' });
    assert.deepEqual(calls, []);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await screen.findByRole('heading', { name: 'Done' });
    assert.deepEqual(calls, [['complete', 't1', 'cancel', {}, '']]);
  });

  it('shows why completing failed next to the field and keeps the decision open', async () => {
    const { client } = fakeClient({
      complete: async () => {
        throw Object.assign(new Error('Some fields are invalid'), {
          status: 422,
          body: { fields: { note: 'Note is too long' } }
        });
      }
    });
    const { toasts, user } = await openTask(client);
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await screen.findAllByRole('alert');
    assert.deepEqual(
      screen.getAllByRole('alert').map((a) => a.textContent),
      ['Some fields are invalid', 'Note is too long']
    );
    assert.ok(!screen.queryByRole('heading', { name: 'Done' }));
    assert.equal(screen.getByRole('button', { name: 'Approve' }).getAttribute('aria-busy'), null);
    assert.deepEqual(toasts, []);
  });

  it('blocks an outcome until the field it needs is filled in', async () => {
    const { client, calls } = fakeClient({
      find: async () =>
        task({
          fields: [{ name: 'payerId', type: 'string', label: 'Payer ID', required: ['link'] }],
          outcomes: ['link', 'unlisted'],
          defaults: null
        })
    });
    const { user } = await openTask(client);
    const link = screen.getByRole('button', { name: 'Link Payer' });
    assert.equal(link.getAttribute('aria-disabled'), 'true');
    assert.ok(
      screen.getByRole('button', { name: 'Link Payer', description: 'Fill in Payer ID first.' })
    );
    await user.click(link);
    assert.deepEqual(calls, []);
    await user.type(screen.getByRole('textbox', { name: /^Payer ID/ }), 'P-77');
    const ready = screen.getByRole('button', { name: 'Link Payer' });
    assert.equal(ready.getAttribute('aria-disabled'), null);
    await user.click(ready);
    await screen.findByRole('heading', { name: 'Done' });
    assert.deepEqual(calls, [['complete', 't1', 'link', { payerId: 'P-77' }, '']]);
  });

  it('holds the other outcomes while one is being recorded', async () => {
    let finish: () => void = () => undefined;
    const { client } = fakeClient({
      complete: () =>
        new Promise((resolve) => {
          finish = () => resolve({ status: 'completed' });
        })
    });
    const { user } = await openTask(client);
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    assert.equal(screen.getByRole('button', { name: 'Approve' }).getAttribute('aria-busy'), 'true');
    assert.equal(
      screen.getByRole('button', { name: 'Void' }).getAttribute('aria-disabled'),
      'true'
    );
    assert.ok(
      screen.getByRole('button', {
        name: 'Void',
        description: 'Wait for this to finish. Closes the claim as void; it is never billed.'
      })
    );
    assert.equal(screen.getByRole('textbox', { name: 'Note' }).matches(':disabled'), true);
    finish();
    await screen.findByRole('heading', { name: 'Done' });
  });

  it('does not complete a task the user lacks the permission for', async () => {
    const { client, calls } = fakeClient({
      find: async () => task({ permission: 'payers:update' })
    });
    const { user } = await openTask(client);
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    assert.deepEqual(calls, []);
    assert.ok(screen.getAllByText(/needs a role allowed to: Change payers/).length);
  });

  it('assigns the task to the user, then lets them hand it back', async () => {
    let assignee: string | null = null;
    const { client, calls } = fakeClient({
      find: async () => task({ assignee_id: assignee }),
      assign: async (id: string) => {
        calls.push(['assign', id]);
        assignee = 'u1';
        return { status: 'assigned' };
      }
    });
    const { toasts, user } = await openTask(client);
    await user.click(screen.getByRole('button', { name: 'Assign to Me' }));
    await user.click(await screen.findByRole('button', { name: 'Unassign' }));
    await waitFor(() => assert.equal(toasts.length, 2));
    assert.deepEqual(calls, [
      ['assign', 't1'],
      ['unassign', 't1']
    ]);
    assert.deepEqual(
      toasts.map((t) => t.title),
      ['Assigned to you', 'Unassigned']
    );
  });

  it('says why assigning failed', async () => {
    const { client } = fakeClient({
      assign: async () => {
        throw new Error('Someone else took this task');
      }
    });
    const { toasts, user } = await openTask(client);
    await user.click(screen.getByRole('button', { name: 'Assign to Me' }));
    assert.equal((await screen.findByRole('alert')).textContent, 'Someone else took this task');
    assert.deepEqual(toasts, []);
  });

  it('reloads the task when it changes elsewhere', async () => {
    const listeners: Parameters<Live['subscribe']>[0][] = [];
    let status: TaskDetail['status'] = 'open';
    const { client } = fakeClient({ find: async () => task({ status }) });
    await openTask(client, {
      live: {
        ...idleLive,
        subscribe: (l) => {
          listeners.push(l);
          return () => undefined;
        }
      }
    });
    status = 'cancelled';
    for (const l of listeners) l({ kind: 'task', id: 't1', runId: null });
    assert.ok(await screen.findByText('This task was cancelled.'));
  });

  it('shows why the task could not be loaded', async () => {
    const { client } = fakeClient({
      find: async () => {
        throw new Error('Task not found');
      }
    });
    await openTask(client);
    assert.ok(screen.getByRole('heading', { name: 'Something Went Wrong' }));
    assert.ok(screen.getByText('Task not found'));
  });
});
