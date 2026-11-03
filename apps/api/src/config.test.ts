import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseConfig } from './config.ts';

const rawEnv = {
  NODE_ENV: 'test',
  API_PORT: '3001',
  SSE_URL: 'http://localhost:3002',
  HTTP_CORS_ORIGINS: 'http://localhost:3000',
  HTTP_MAX_BODY_BYTES: '1000000',
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_USER: 'ugula',
  DB_PASSWORD: 'secret',
  DB_NAME: 'ugula',
  API_DB_POOL_MAX: '20',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
  REDIS_PASSWORD: 'secret',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'ugula',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
  IMPORT_FILE_MAX_BYTES: '1000',
  SFTP_HOOK_SECRET: 'x'.repeat(32),
  SFTP_S3_ENDPOINT: 'http://rustfs:9000',
  SFTP_HOME_ROOT: '/srv/sftpgo/data',
  EMBEDDINGS_URL: 'http://localhost:8080'
};

describe('api parseConfig', () => {
  it('parses valid env and rejects missing vars', () => {
    const config = parseConfig(rawEnv);
    assert.equal(config.API_PORT, 3001);
    assert.equal(config.HTTP_MAX_BODY_BYTES, 1_000_000);
    assert.equal(config.DB_PORT, 5432);
    assert.equal(config.REDIS_PORT, 6379);
    assert.throws(() => parseConfig({}));
    assert.throws(() => parseConfig({ ...rawEnv, SFTP_HOOK_SECRET: 'short' }));
    assert.throws(() => parseConfig({ ...rawEnv, API_PORT: 'http' }));
    assert.throws(() => parseConfig({ ...rawEnv, SSE_URL: 'not a url' }));
  });
});
