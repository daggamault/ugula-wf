import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db';
import type { JobBoss } from '@ugula/jobs';
import type { CompiledQuery } from 'kysely';
import { createRunService } from './service.ts';

const recordingBoss = () => {
  const jobs: unknown[] = [];
  const boss: JobBoss = { insert: async (_name, batch) => void jobs.push(...batch) };
  return { boss, jobs };
};

const codeOf = (res: { ok: boolean; failure?: { code: string } }) =>
  res.ok ? 'ok' : res.failure?.code;

describe('run service', () => {
  it('starts the latest published version and enqueues it in the same transaction', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('select') ? [{ id: 'v1', version: 4 }] : [{ id: 'r1' }]
    );
    const { boss, jobs } = recordingBoss();
    assert.deepEqual(await createRunService({ db, boss }).start('t-1', 'g1', undefined, { a: 1 }), {
      ok: true,
      value: { id: 'r1', version: 4 }
    });
    assert.ok(queries.some((q) => q.parameters.includes('{"a":1}')));
    assert.deepEqual(jobs, [{ data: { runId: 'r1', command: { type: 'advance' } } }]);
  });

  it('fails to start when nothing is published', async () => {
    const { db } = createRecordingDb();
    const res = await createRunService({ db, boss: recordingBoss().boss }).start('t', 'g', 2, {});
    assert.equal(codeOf(res), 'not_found');
  });

  it('cancels only active runs', async () => {
    const withStatus = (status: string) => createRecordingDb(() => [{ id: 'r1', status }]).db;
    const { boss, jobs } = recordingBoss();
    assert.equal(
      codeOf(await createRunService({ db: withStatus('suspended'), boss }).cancel('t', 'r1')),
      'ok'
    );
    assert.equal(
      codeOf(await createRunService({ db: withStatus('completed'), boss }).cancel('t', 'r1')),
      'conflict'
    );
    assert.equal(
      codeOf(await createRunService({ db: createRecordingDb().db, boss }).cancel('t', 'r1')),
      'not_found'
    );
    assert.equal(jobs.length, 1);
  });

  it('resumes every run waiting on a signal', async () => {
    const { db, queries } = createRecordingDb(() => [
      { id: 'r1', wait_id: '4' },
      { id: 'r2', wait_id: '9' }
    ]);
    const { boss, jobs } = recordingBoss();
    assert.deepEqual(
      await createRunService({ db, boss }).signal('t-1', 'ack', 'C1', { ok: true }),
      {
        ok: true,
        value: { resumed: 2 }
      }
    );
    assert.ok(queries[0]?.parameters.includes('ack:C1'));
    assert.deepEqual(jobs[1], {
      data: {
        runId: 'r2',
        command: { type: 'resume', suspensionId: '9', payload: { payload: { ok: true } } }
      }
    });
  });

  it('reads detail, steps and bundles only for visible runs', async () => {
    const visible = (q: CompiledQuery) =>
      q.sql.includes('count(*)')
        ? [{ count: '1200' }]
        : q.sql.includes('"r"."id" = $')
          ? [{ id: 'r1', version_id: 'v1' }]
          : [];
    const service = createRunService({
      db: createRecordingDb(visible).db,
      boss: recordingBoss().boss
    });
    assert.deepEqual(await service.find('t', 'r1'), {
      ok: true,
      value: { run: { id: 'r1', version_id: 'v1' }, children: [], childCount: 1200, tasks: [] }
    });
    assert.deepEqual(await service.graphs('t', 'r1'), { ok: true, value: { graphs: [] } });
    assert.deepEqual(await service.steps('t', 'r1', { after: 0, limit: 10 }), {
      ok: true,
      value: { steps: [] }
    });
    const hidden = createRunService({ db: createRecordingDb().db, boss: recordingBoss().boss });
    for (const res of [
      await hidden.find('t', 'x'),
      await hidden.graphs('t', 'x'),
      await hidden.steps('t', 'x', { after: 0, limit: 1 })
    ]) {
      assert.equal(codeOf(res), 'not_found');
    }
    assert.equal(codeOf(await hidden.list('t', { rootOnly: true, limit: 5 })), 'ok');
  });
});
