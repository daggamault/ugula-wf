import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import type { RunQueueClient } from '@ugula/run-queue';
import type { CompiledQuery } from 'kysely';
import { createRunService } from './service.ts';

const recordingBoss = () => {
  const jobs: unknown[] = [];
  const boss: RunQueueClient = { insert: async (_name, batch) => void jobs.push(...batch) };
  return { boss, jobs };
};

const codeOf = (res: { ok: boolean; failure?: { code: string } }) =>
  res.ok ? 'ok' : res.failure?.code;

const stored: string[] = [];

const blobs = {
  putBytes: async (key: string, body: Uint8Array, contentType: string) => {
    stored.push(`${key} ${contentType} ${body.byteLength}`);
    return { bucket: 'ugula', key, size: body.byteLength, contentType };
  }
};

describe('run service', () => {
  it('starts the latest published version and enqueues it in the same transaction', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('select') ? [{ id: 'v1', version: 4 }] : [{ id: 'r1' }]
    );
    const { boss, jobs } = recordingBoss();
    assert.deepEqual(
      await createRunService({ db, boss, blobs, maxBytes: 100 }).start('t-1', 'g1', undefined, {
        a: 1
      }),
      {
        ok: true,
        value: { id: 'r1', version: 4 }
      }
    );
    assert.ok(queries.some((q) => q.parameters.includes('{"a":1}')));
    assert.deepEqual(jobs, [{ data: { runId: 'r1', command: { type: 'advance' } } }]);
  });

  it('fails to start when nothing is published', async () => {
    const { db } = createRecordingDb();
    const res = await createRunService({
      db,
      boss: recordingBoss().boss,
      blobs,
      maxBytes: 100
    }).start('t', 'g', 2, {});
    assert.equal(codeOf(res), 'not_found');
  });

  it('cancels only active runs', async () => {
    const withStatus = (status: string) => createRecordingDb(() => [{ id: 'r1', status }]).db;
    const { boss, jobs } = recordingBoss();
    assert.equal(
      codeOf(
        await createRunService({ db: withStatus('suspended'), boss, blobs, maxBytes: 100 }).cancel(
          't',
          'r1'
        )
      ),
      'ok'
    );
    assert.equal(
      codeOf(
        await createRunService({ db: withStatus('completed'), boss, blobs, maxBytes: 100 }).cancel(
          't',
          'r1'
        )
      ),
      'conflict'
    );
    assert.equal(
      codeOf(
        await createRunService({ db: createRecordingDb().db, boss, blobs, maxBytes: 100 }).cancel(
          't',
          'r1'
        )
      ),
      'not_found'
    );
    assert.equal(jobs.length, 1);
  });

  it('reads detail, steps and bundles only for visible runs', async () => {
    const visible = (q: CompiledQuery) =>
      q.sql.includes('count(*)')
        ? [{ count: '1200' }]
        : q.sql.includes('"id" = $')
          ? [{ id: 'r1', version_id: 'v1' }]
          : [];
    const service = createRunService({
      db: createRecordingDb(visible).db,
      boss: recordingBoss().boss,
      blobs,
      maxBytes: 100
    });
    assert.deepEqual(await service.find('t', 'r1'), {
      ok: true,
      value: {
        run: { id: 'r1', version_id: 'v1' },
        children: [],
        childCount: 1200,
        tasks: [],
        ancestors: []
      }
    });
    assert.deepEqual(await service.graphs('t', 'r1'), { ok: true, value: { graphs: [] } });
    assert.deepEqual(await service.steps('t', 'r1', { after: 0, limit: 10 }), {
      ok: true,
      value: { steps: [] }
    });
    const hidden = createRunService({
      db: createRecordingDb().db,
      boss: recordingBoss().boss,
      blobs,
      maxBytes: 100
    });
    for (const res of [
      await hidden.find('t', 'x'),
      await hidden.graphs('t', 'x'),
      await hidden.steps('t', 'x', { after: 0, limit: 1 })
    ]) {
      assert.equal(codeOf(res), 'not_found');
    }
    assert.equal(
      codeOf(
        await hidden.list('t', {
          rootOnly: true,
          page: 1,
          pageSize: 25,
          sort: 'started' as const,
          dir: 'desc' as const
        })
      ),
      'ok'
    );
  });
});

describe('run input files', () => {
  it('stores an uploaded file for a run input and refuses empty or oversized files', async () => {
    const service = createRunService({
      db: createRecordingDb().db,
      boss: recordingBoss().boss,
      blobs,
      maxBytes: 4
    });
    const res = await service.uploadFile('t-1', {
      name: 'pcr.xml',
      type: 'text/xml',
      bytes: new Uint8Array(3)
    });
    assert.ok(res.ok);
    assert.match(res.value.file.key, /^imports\/t-1\/uploads\/[0-9a-f-]{36}\/pcr\.xml$/);
    assert.deepEqual([res.value.file.bucket, res.value.name], ['ugula', 'pcr.xml']);
    assert.match(stored.at(-1) ?? '', / text\/xml 3$/);
    const empty = await service.uploadFile('t-1', { name: 'a', type: '', bytes: new Uint8Array() });
    assert.equal(codeOf(empty), 'invalid');
    const big = await service.uploadFile('t-1', { name: 'a', type: '', bytes: new Uint8Array(5) });
    assert.equal(codeOf(big), 'invalid');
  });
});

describe('run service agency scoping', () => {
  it('looks runs up in the caller agency before cancelling or starting', async () => {
    const { db, queries } = createRecordingDb();
    const service = createRunService({ db, boss: recordingBoss().boss, blobs, maxBytes: 100 });
    assert.equal(codeOf(await service.cancel('t-2', 'r1')), 'not_found');
    assert.equal(codeOf(await service.start('t-2', 'g1', undefined, {})), 'not_found');
    const [cancel, start] = queries.filter((q) => q.sql.startsWith('select'));
    assert.deepEqual(cancel?.parameters, ['t-2', 'r1']);
    assert.ok(start?.parameters.includes('t-2'));
    assert.ok(!queries.some((q) => q.sql.startsWith('insert')));
  });

  it('stores files without a type as binary', async () => {
    const service = createRunService({
      db: createRecordingDb().db,
      boss: recordingBoss().boss,
      blobs,
      maxBytes: 4
    });
    assert.ok(
      (await service.uploadFile('t-1', { name: 'a', type: '', bytes: new Uint8Array(1) })).ok
    );
    assert.match(stored.at(-1) ?? '', / application\/octet-stream 1$/);
  });
});
