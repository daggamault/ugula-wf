import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseConfig } from './config.ts';

const rawEnv = {
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_USER: 'ugula',
  DB_PASSWORD: 'password',
  DB_NAME: 'ugula',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
  REDIS_PASSWORD: 'secret',
  S3_ENDPOINT: 'http://localhost:9000',
  EMBEDDINGS_URL: 'http://localhost:8080',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'ugula',
  S3_ACCESS_KEY: 'key',
  S3_SECRET_KEY: 'secret'
};

describe('worker parseConfig', () => {
  it('parses valid env, defaults workflow concurrency, and rejects missing vars', () => {
    const config = parseConfig(rawEnv);
    assert.equal(config.DB_PORT, 5432);
    assert.equal(config.WORKER_RUN_CONCURRENCY, 8);
    assert.equal(parseConfig({ ...rawEnv, WORKER_RUN_CONCURRENCY: '2' }).WORKER_RUN_CONCURRENCY, 2);
    assert.throws(() => parseConfig({}));
    assert.throws(() => parseConfig({ ...rawEnv, WORKER_RUN_CONCURRENCY: '0' }));
  });

  it('defaults load limits to 90% event loop and the heap limit, and bounds utilization', () => {
    const config = parseConfig(rawEnv);
    assert.equal(config.WORKER_MAX_EVENT_LOOP_UTILIZATION, 0.9);
    assert.equal(config.WORKER_MAX_HEAP_MB, undefined);
    assert.equal(config.WORKER_MAX_RSS_MB, undefined);
    const set = parseConfig({
      ...rawEnv,
      WORKER_MAX_EVENT_LOOP_UTILIZATION: '0.75',
      WORKER_MAX_HEAP_MB: '1536',
      WORKER_MAX_RSS_MB: '3072'
    });
    assert.deepEqual(
      [set.WORKER_MAX_EVENT_LOOP_UTILIZATION, set.WORKER_MAX_HEAP_MB, set.WORKER_MAX_RSS_MB],
      [0.75, 1536, 3072]
    );
    assert.throws(() => parseConfig({ ...rawEnv, WORKER_MAX_EVENT_LOOP_UTILIZATION: '1.5' }));
    assert.throws(() => parseConfig({ ...rawEnv, WORKER_MAX_EVENT_LOOP_UTILIZATION: 'busy' }));
  });
});
