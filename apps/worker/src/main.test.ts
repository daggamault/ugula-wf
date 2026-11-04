import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PgBoss } from 'pg-boss';
import { createWorker, poolSize, stopWorker } from './main.ts';

describe('worker createWorker', () => {
  it('creates a PgBoss instance from parsed config', () => {
    const boss = createWorker({
      DB_HOST: 'localhost',
      DB_PORT: 5432,
      DB_USER: 'ugula',
      DB_PASSWORD: 'password',
      DB_NAME: 'ugula',
      WORKFLOW_CONCURRENCY: 8,
      COMPLETIONS_CONCURRENCY: 2,
      WORKER_MAX_EVENT_LOOP_UTILIZATION: 0.9,
      CLEARINGHOUSE_SFTP_PORT: 22,
      CLEARINGHOUSE_UPLOAD_PATH: '/',
      CLEARINGHOUSE_DOWNLOAD_PATHS: ['/'],
      CLEARINGHOUSE_FILE_EXTENSION: '.txt',
      CLEARINGHOUSE_ELIGIBILITY_EXTENSION: '.txt',
      CLEARINGHOUSE_CLAIM_STATUS_EXTENSION: '.txt',
      CLEARINGHOUSE_REALTIME_URL: '',
      CLEARINGHOUSE_REALTIME_TIMEOUT_SECONDS: 30,
      CLEARINGHOUSE_AFTER_DOWNLOAD: 'delete',
      CLEARINGHOUSE_POLL_MINUTES: 1,
      REDIS_HOST: 'localhost',
      REDIS_PORT: 6379,
      REDIS_PASSWORD: 'secret',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_REGION: 'us-east-1',
      S3_BUCKET: 'ugula',
      S3_ACCESS_KEY_ID: 'key',
      S3_SECRET_ACCESS_KEY: 'secret',
      EMBEDDINGS_URL: 'http://localhost:8080',
      COMPLETIONS_URL: 'http://localhost:8081',
      COMPLETIONS_MODEL: 'qwen'
    });
    assert.ok(boss instanceof PgBoss);
  });
});

describe('stopWorker', () => {
  it('stops claiming, drains pg-boss within the timeout, then closes connections', async () => {
    const calls: string[] = [];
    await stopWorker(
      {
        jobs: { stop: () => void calls.push('jobs') },
        live: { flush: async () => void calls.push('live') },
        boss: { stop: async (options) => void calls.push(`boss:${JSON.stringify(options)}`) },
        db: { destroy: async () => void calls.push('db') },
        redis: { quit: async () => calls.push('redis') }
      },
      5_000
    );
    assert.deepEqual(calls, [
      'jobs',
      'boss:{"graceful":true,"timeout":5000}',
      'live',
      'db',
      'redis'
    ]);
  });

  it('sizes the pool for every connection a slot can hold at once', () => {
    assert.equal(poolSize(8), 28);
  });
});
