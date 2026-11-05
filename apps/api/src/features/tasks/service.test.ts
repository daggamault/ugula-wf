import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Permission } from '@ugula/access';
import { createRecordingDb } from '@ugula/db/testing';
import type { RunQueueClient } from '@ugula/run-queue';
import { recordAnnouncements } from '../../shared/testing.ts';
import { createTaskService, fieldErrors, jobFor } from './service.ts';

const task = (patch: Record<string, unknown> = {}) => ({
  id: 't1',
  run_id: 'r1',
  wait_id: '7',
  kind: 'task',
  status: 'open',
  assignee_id: null,
  outcomes: ['approve', 'reject'],
  fields: [{ name: 'note', type: 'string' }],
  ...patch
});

const setup = (row: Record<string, unknown> | undefined, updated = true) => {
  const { db, queries } = createRecordingDb((q) =>
    q.sql.startsWith('select') ? (row ? [row] : []) : updated ? [{ id: 't1' }] : []
  );
  const jobs: unknown[] = [];
  const boss: RunQueueClient = { insert: async (_n, batch) => void jobs.push(...batch) };
  const { announce, events: announced } = recordAnnouncements();
  return { service: createTaskService({ db, boss, announce }), jobs, queries, announced };
};

describe('task service', () => {
  it('refuses to claim, release or complete a task another user is working', async () => {
    const theirs = setup(task({ assignee_id: 'u2' }), false);
    const refused = {
      ok: false,
      failure: { code: 'conflict', message: 'Another user is working this task' }
    };
    assert.deepEqual(await theirs.service.claim('t', 't1', 'u1', []), refused);
    assert.deepEqual(await theirs.service.release('t', 't1', 'u1'), refused);
    assert.deepEqual(
      await theirs.service.complete(
        't',
        'u1',
        't1',
        { outcome: 'approve', values: { note: 'x' } },
        []
      ),
      refused
    );
    assert.equal(theirs.jobs.length, 0);
    const gone = setup(undefined, false);
    assert.equal((await gone.service.release('t', 't1', 'u1')).ok, false);
    const done = setup(task({ status: 'completed' }), false);
    assert.deepEqual(await done.service.claim('t', 't1', 'u1', []), {
      ok: false,
      failure: { code: 'conflict', message: 'Task is already closed' }
    });
    const mine = setup(task({ assignee_id: 'u1' }));
    assert.equal(
      (
        await mine.service.complete(
          't',
          'u1',
          't1',
          { outcome: 'approve', values: { note: 'x' } },
          []
        )
      ).ok,
      true
    );
  });

  it('maps completions to run commands', () => {
    const base = { run_id: 'r1', wait_id: '7' };
    assert.deepEqual(
      jobFor({ ...base, kind: 'task' }, 'u1', { outcome: 'approve', values: { a: 1 } }).command,
      {
        type: 'resume',
        suspensionId: '7',
        payload: { outcome: 'approve', values: { a: 1 }, userId: 'u1' }
      }
    );
    assert.deepEqual(
      jobFor({ ...base, kind: 'fault' }, 'u1', { outcome: 'retry', values: {} }).command,
      { type: 'retry' }
    );
    assert.deepEqual(
      jobFor({ ...base, kind: 'fault' }, 'u1', {
        outcome: 'skip',
        values: { pin: 'then', outputs: { x: 1 } }
      }).command,
      { type: 'skip', pin: 'then', outputs: { x: 1 } }
    );
    assert.deepEqual(
      jobFor({ ...base, kind: 'fault' }, 'u1', { outcome: 'cancel', values: {} }).command,
      { type: 'cancel' }
    );
  });

  it('checks field values against their types', () => {
    assert.deepEqual(fieldErrors([{ name: 'n', type: 'integer' }], { n: 1.5 }, 'approve'), {
      n: 'expected integer, got number'
    });
    assert.deepEqual(
      fieldErrors(
        [{ name: 'pin', type: 'string', options: [{ value: 'then', label: 'then' }] }],
        { pin: 'x' },
        'skip'
      ),
      { pin: 'must be one of then' }
    );
    assert.deepEqual(fieldErrors(null, {}, 'approve'), {});
  });

  it('applies required-for-outcome, date format and range rules', () => {
    const due = { name: 'due', type: 'string', format: 'date', required: ['approve'] };
    assert.deepEqual(fieldErrors([due], {}, 'approve'), { due: 'is required' });
    assert.deepEqual(fieldErrors([due], {}, 'reject'), {});
    assert.deepEqual(fieldErrors([due], { due: '2026-13-01' }, 'reject'), {
      due: 'must be a date (YYYY-MM-DD)'
    });
    assert.deepEqual(fieldErrors([{ name: 'n', type: 'number', min: 1 }], { n: 0 }, 'approve'), {
      n: 'must be at least 1'
    });
  });

  it('completes open tasks and resumes the run atomically', async () => {
    const { service, jobs, announced } = setup(task());
    assert.deepEqual(
      await service.complete('t', 'u1', 't1', { outcome: 'approve', values: { note: 'ok' } }, []),
      { ok: true, value: { status: 'completed' } }
    );
    assert.equal(jobs.length, 1);
    assert.deepEqual(announced, [
      { agencyId: 't', event: { kind: 'task', id: 't1', runId: null } }
    ]);
  });

  it('rejects unknown, closed, invalid and raced completions', async () => {
    const status = async (
      row: Record<string, unknown> | undefined,
      outcome = 'approve',
      values = {},
      updated = true
    ) => {
      const res = await setup(row, updated).service.complete(
        't',
        'u1',
        't1',
        { outcome, values },
        []
      );
      return res.ok ? 'ok' : res.failure.code;
    };
    assert.equal(await status(undefined), 'not_found');
    assert.equal(await status(task({ status: 'completed' })), 'conflict');
    assert.equal(await status(task(), 'maybe'), 'invalid');
    assert.equal(await status(task(), 'approve', { note: 3 }), 'invalid');
    assert.equal(
      await status(
        task({ kind: 'fault', fields: [{ name: 'pin', type: 'string' }] }),
        'reject',
        {},
        true
      ),
      'ok'
    );
    assert.equal(await status(task(), 'approve', { note: 'x' }, false), 'conflict');
    const approval = task({ permission: 'claims:approve' });
    const approve = (permissions: Permission[]) =>
      setup(approval).service.complete(
        't',
        'u1',
        't1',
        { outcome: 'approve', values: {} },
        permissions
      );
    assert.deepEqual(await approve(['tasks:update']), {
      ok: false,
      failure: {
        code: 'forbidden',
        message: 'Completing this task needs the claims:approve permission'
      }
    });
    assert.equal((await approve(['claims:approve'])).ok, true);
    const rejected = setup(undefined);
    await rejected.service.complete('t', 'u1', 't1', { outcome: 'approve', values: {} }, []);
    assert.deepEqual(rejected.announced, []);
  });

  it('refuses to claim a task that needs a permission the user lacks', async () => {
    const approval = setup(task({ permission: 'claims:approve' }));
    assert.deepEqual(await approval.service.claim('t', 't1', 'u1', ['tasks:update']), {
      ok: false,
      failure: {
        code: 'forbidden',
        message: 'Completing this task needs the claims:approve permission'
      }
    });
    assert.ok(!approval.queries.some((q) => q.sql.startsWith('update "tasks"')));
    assert.equal((await approval.service.claim('t', 't1', 'u1', ['claims:approve'])).ok, true);
  });

  it('hands out next only tasks the user may complete', async () => {
    const { service, queries } = setup(task());
    await service.next('t', null, 'u1', ['tasks:update', 'claims:read']);
    assert.ok(queries[0]?.sql.includes('("permission" is null or permission = any($'));
    assert.ok(queries[0]?.parameters.some((p) => Array.isArray(p) && p.includes('claims:read')));
  });

  it('validates the pin and outputs of skipped faults only', async () => {
    const fault = task({
      kind: 'fault',
      outcomes: ['retry', 'skip', 'cancel'],
      fields: [
        { name: 'pin', type: 'string', options: [{ value: 'then', label: 'then' }] },
        { name: 'outputs', type: { object: {} } }
      ]
    });
    const code = async (outcome: string, values: Record<string, unknown>) => {
      const res = await setup(fault).service.complete(
        't',
        'u1',
        't1',
        { outcome, values: values as never },
        []
      );
      return res.ok ? 'ok' : res.failure.code;
    };
    assert.equal(await code('skip', { pin: 'nope' }), 'invalid');
    assert.equal(await code('skip', { pin: 'then', outputs: 'x' }), 'invalid');
    assert.equal(await code('skip', { pin: 'then', outputs: { a: 1 } }), 'ok');
    assert.equal(await code('retry', { pin: 'nope' }), 'ok');
  });

  it('reads, hands out and assigns tasks', async () => {
    const { service, queries } = setup(task());
    await service.next('t', 'billing', 'u1', []);
    assert.ok(queries[0]?.sql.includes('for update skip locked'));
    assert.deepEqual(await service.release('t', 't1', 'u1'), {
      ok: true,
      value: { status: 'released' }
    });
    assert.deepEqual(await service.claim('t', 't1', 'u1', []), {
      ok: true,
      value: { status: 'claimed' }
    });
    const found = await service.find('t', 't1');
    assert.deepEqual(found.ok && found.value.task.source, {
      reportId: null,
      pcrNumber: null,
      claim: null
    });
    const source = queries.find((q) => q.sql.includes('left join "import_reports"'));
    assert.ok(
      source?.sql.includes(
        'left join "claim_runs" as "cr" on "cr"."run_id" = "r"."id" left join "claims" as "c" on "c"."id" = "cr"."claim_id"'
      )
    );
    assert.ok(source?.sql.includes('coalesce("ir"."id", "c"."import_report_id") as "report_id"'));
    assert.equal((await service.queues('t', 'u1')).ok, true);
  });
});

describe('task service sources and hand-out', () => {
  it('links a task to the claim and patient its run works', async () => {
    const { db } = createRecordingDb((q) =>
      q.sql.includes('from "workflow_runs"')
        ? [
            {
              report_id: 'rep-1',
              pcr_number: 'PCR-1',
              claim_id: 'c1',
              claim_number: 12,
              claim_status: 'ready',
              first_name: 'Jane',
              last_name: 'Doe'
            }
          ]
        : [task()]
    );
    const { announce } = recordAnnouncements();
    const boss: RunQueueClient = { insert: async () => undefined };
    const found = await createTaskService({ db, boss, announce }).find('t', 't1');
    assert.deepEqual(found.ok && found.value.task.source, {
      reportId: 'rep-1',
      pcrNumber: 'PCR-1',
      claim: { id: 'c1', number: 12, status: 'ready', patient: 'Doe, Jane' }
    });
  });

  it('reports missing tasks and announces only tasks handed out', async () => {
    const empty = setup(undefined, false);
    assert.deepEqual(await empty.service.find('t', 't1'), {
      ok: false,
      failure: { code: 'not_found', message: 'Task not found' }
    });
    assert.deepEqual(await empty.service.next('t', null, 'u1', []), {
      ok: true,
      value: { task: null }
    });
    assert.deepEqual(empty.announced, []);
    const full = setup(task());
    const next = await full.service.next('t', null, 'u1', []);
    assert.equal(next.ok && next.value.task?.id, 't1');
    assert.deepEqual(full.announced, [
      { agencyId: 't', event: { kind: 'task', id: 't1', runId: null } }
    ]);
  });
});
