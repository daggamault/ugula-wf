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

const scope = { agencyId: 't-1' };

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
      q.sql.startsWith('select')
        ? [{ id: 'v1', version: 4, key: 'k', base: false }]
        : [{ id: 'r1' }]
    );
    const { boss, jobs } = recordingBoss();
    assert.deepEqual(
      await createRunService({ db, boss, blobs, maxBytes: 100 }).start(
        scope,
        'u1',
        'g1',
        undefined,
        {
          a: 1
        }
      ),
      {
        ok: true,
        value: { id: 'r1', version: 4 }
      }
    );
    assert.ok(queries.some((q) => q.parameters.includes('{"a":1}') && q.parameters.includes('u1')));
    assert.ok(!queries.some((q) => q.sql.includes('as req (key, version)')));
    assert.deepEqual(jobs, [{ data: { runId: 'r1', command: { type: 'advance' } }, priority: 2 }]);
  });

  it('runs the effective override of a standard workflow', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('as req (key, version)')
        ? [{ id: 'override-v2', key: 'k', version: 4 }]
        : q.sql.startsWith('select')
          ? [{ id: 'v1', version: 4, key: 'k', base: true }]
          : [{ id: 'r1' }]
    );
    const res = await createRunService({
      db,
      boss: recordingBoss().boss,
      blobs,
      maxBytes: 100
    }).start(scope, 'u1', 'g1', 4, {});
    assert.deepEqual(res, { ok: true, value: { id: 'r1', version: 4 } });
    const lookup = queries.find((q) => q.sql.includes('as req (key, version)'));
    assert.deepEqual(lookup?.parameters.slice(0, 2), [['k'], [4]]);
    assert.ok(
      queries.some((q) => q.sql.startsWith('insert') && q.parameters.includes('override-v2'))
    );
  });

  it('fails to start when nothing is published', async () => {
    const { db, queries } = createRecordingDb();
    const res = await createRunService({
      db,
      boss: recordingBoss().boss,
      blobs,
      maxBytes: 100
    }).start(scope, 'u1', 'g', 2, {});
    assert.deepEqual(res, {
      ok: false,
      failure: { code: 'not_found', message: 'No published version to run' }
    });
    assert.ok(!queries.some((q) => q.sql.startsWith('insert')));
  });

  it('fails to start a standard workflow when no version of it is in effect for the agency', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('as req (key, version)')
        ? []
        : q.sql.startsWith('select')
          ? [{ id: 'v1', version: 4, key: 'k', base: true }]
          : [{ id: 'r1' }]
    );
    const { boss, jobs } = recordingBoss();
    const res = await createRunService({ db, boss, blobs, maxBytes: 100 }).start(
      scope,
      'u1',
      'g1',
      4,
      {}
    );
    assert.deepEqual(res, {
      ok: false,
      failure: { code: 'not_found', message: 'No published version to run' }
    });
    assert.ok(!queries.some((q) => q.sql.startsWith('insert')));
    assert.deepEqual(jobs, []);
  });

  it('cancels only active runs', async () => {
    const withStatus = (status: string) => createRecordingDb(() => [{ id: 'r1', status }]).db;
    const { boss, jobs } = recordingBoss();
    const cancel = (db: ReturnType<typeof withStatus>) =>
      createRunService({ db, boss, blobs, maxBytes: 100 }).cancel('t', 'r1');
    assert.deepEqual(await cancel(withStatus('suspended')), {
      ok: true,
      value: { status: 'cancelling' }
    });
    assert.deepEqual(
      jobs.map((j) => (j as { data: unknown }).data),
      [{ runId: 'r1', command: { type: 'cancel' } }]
    );
    assert.deepEqual(await cancel(withStatus('completed')), {
      ok: false,
      failure: { code: 'conflict', message: 'Run already finished' }
    });
    assert.deepEqual(await cancel(createRecordingDb().db), {
      ok: false,
      failure: { code: 'not_found', message: 'Run not found' }
    });
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
      assert.deepEqual(res, {
        ok: false,
        failure: { code: 'not_found', message: 'Run not found' }
      });
    }
    assert.deepEqual(
      await hidden.search('t', {
        rootOnly: true,
        status: [],
        workflow: [],
        page: 1,
        pageSize: 25,
        sort: 'started' as const,
        dir: 'desc' as const
      }),
      {
        ok: true,
        value: {
          items: [],
          total: 0,
          page: 1,
          pageSize: 25,
          facets: { status: [], workflow: [] }
        }
      }
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
    assert.deepEqual(res.value, {
      file: { bucket: 'ugula', key: res.value.file.key },
      name: 'pcr.xml'
    });
    assert.match(stored.at(-1) ?? '', / text\/xml 3$/);
    const before = stored.length;
    const empty = await service.uploadFile('t-1', { name: 'a', type: '', bytes: new Uint8Array() });
    assert.deepEqual(empty, {
      ok: false,
      failure: { code: 'invalid', message: 'The file is empty' }
    });
    const big = await service.uploadFile('t-1', { name: 'a', type: '', bytes: new Uint8Array(5) });
    assert.deepEqual(big, {
      ok: false,
      failure: { code: 'invalid', message: 'The file is larger than 4 bytes' }
    });
    assert.equal(stored.length, before);
  });
});

describe('run service agency scoping', () => {
  it('looks runs up in the caller agency before cancelling or starting', async () => {
    const { db, queries } = createRecordingDb();
    const service = createRunService({ db, boss: recordingBoss().boss, blobs, maxBytes: 100 });
    assert.equal(codeOf(await service.cancel('t-2', 'r1')), 'not_found');
    assert.equal(
      codeOf(await service.start({ agencyId: 't-2' }, 'u2', 'g1', undefined, {})),
      'not_found'
    );
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
