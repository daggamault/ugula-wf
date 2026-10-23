import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PgBoss } from 'pg-boss';
import { createWorker } from './main.ts';

describe('worker createWorker', () => {
  it('creates a PgBoss instance from parsed config', () => {
    const boss = createWorker({
      DB_HOST: 'localhost',
      DB_PORT: 5432,
      DB_USER: 'ugula',
      DB_PASSWORD: 'password',
      DB_NAME: 'ugula',
      WORKFLOW_CONCURRENCY: 8,
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
