import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PgBoss } from 'pg-boss';
import { createWorker, poolSize, stopWorker } from './main.ts';

describe('worker createWorker', () => {
  it('creates a PgBoss instance from parsed config', () => {
    const boss = createWorker({
      NODE_ENV: 'test',
      DB_HOST: 'localhost',
      DB_PORT: 5432,
      DB_USER: 'ugula',
      DB_PASSWORD: 'password',
      DB_NAME: 'ugula',
      WORKER_RUN_CONCURRENCY: 8,
      WORKER_MAX_EVENT_LOOP_UTILIZATION: 0.9,
      REDIS_HOST: 'localhost',
      REDIS_PORT: 6379,
      REDIS_PASSWORD: 'secret',
      S3_ENDPOINT: 'http://localhost:9000',
      EMBEDDINGS_URL: 'http://localhost:8080',
      S3_REGION: 'us-east-1',
      S3_BUCKET: 'ugula',
      S3_ACCESS_KEY: 'key',
      S3_SECRET_KEY: 'secret'
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
        events: { stop: async () => void calls.push('events') },
        live: { flush: async () => void calls.push('live') },
        boss: { stop: async (options) => void calls.push(`boss:${JSON.stringify(options)}`) },
        db: { destroy: async () => void calls.push('db') },
        redis: { quit: async () => calls.push('redis') }
      },
      5_000
    );
    assert.deepEqual(calls, [
      'jobs',
      'events',
      'boss:{"graceful":true,"timeout":5000}',
      'live',
      'db',
      'redis'
    ]);
  });
});

describe('poolSize', () => {
  it('holds three connections per run slot plus four spare', () => {
    assert.equal(poolSize(1), 7);
    assert.equal(poolSize(8), 28);
  });
});
