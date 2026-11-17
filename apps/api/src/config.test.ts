import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseConfig } from './config.ts';

const KEY = `${'A'.repeat(43)}=`;

const rawEnv = {
  NODE_ENV: 'test',
  API_PORT: '3001',
  SSE_URL: 'http://localhost:3002',
  WEB_URL: 'http://localhost:3000',
  API_CORS_ORIGINS: 'http://localhost:3000',
  API_MAX_BODY_BYTES: '1000000',
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
  S3_ACCESS_KEY: 'key',
  S3_SECRET_KEY: 'secret',
  API_MAX_IMPORT_BYTES: '1000',
  SFTP_HOOK_SECRET: 'x'.repeat(32),
  SFTP_S3_ENDPOINT: 'http://rustfs:9000',
  SFTP_HOME_ROOT: '/srv/sftpgo/data',
  EMBEDDINGS_URL: 'http://localhost:8080'
};

describe('api parseConfig', () => {
  it('parses a valid env, turning ports and sizes into numbers and defaulting no previous keys', () => {
    assert.deepEqual(parseConfig(rawEnv), {
      NODE_ENV: 'test',
      API_PORT: 3001,
      SSE_URL: 'http://localhost:3002',
      WEB_URL: 'http://localhost:3000',
      API_CORS_ORIGINS: 'http://localhost:3000',
      API_MAX_BODY_BYTES: 1_000_000,
      DB_HOST: 'localhost',
      DB_PORT: 5432,
      DB_USER: 'ugula',
      DB_PASSWORD: 'secret',
      DB_NAME: 'ugula',
      API_DB_POOL_MAX: 20,
      REDIS_HOST: 'localhost',
      REDIS_PORT: 6379,
      REDIS_PASSWORD: 'secret',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_REGION: 'us-east-1',
      S3_BUCKET: 'ugula',
      S3_ACCESS_KEY: 'key',
      S3_SECRET_KEY: 'secret',
      CLEARINGHOUSE_PREVIOUS_SECRET_KEYS: [],
      API_MAX_IMPORT_BYTES: 1000,
      SFTP_HOOK_SECRET: 'x'.repeat(32),
      SFTP_S3_ENDPOINT: 'http://rustfs:9000',
      SFTP_HOME_ROOT: '/srv/sftpgo/data',
      EMBEDDINGS_URL: 'http://localhost:8080'
    });
  });

  it('reads the current secret key trimmed and the previous keys as a list', () => {
    const config = parseConfig({
      ...rawEnv,
      CLEARINGHOUSE_SECRET_KEY: ` ${KEY} `,
      CLEARINGHOUSE_PREVIOUS_SECRET_KEYS: ` ${KEY} ,, ${KEY}`
    });
    assert.deepEqual(
      [config.CLEARINGHOUSE_SECRET_KEY, config.CLEARINGHOUSE_PREVIOUS_SECRET_KEYS],
      [KEY, [KEY, KEY]]
    );
    assert.equal(
      parseConfig({ ...rawEnv, CLEARINGHOUSE_SECRET_KEY: '' }).CLEARINGHOUSE_SECRET_KEY,
      ''
    );
  });

  it('rejects secret keys that are not 32 base64 bytes', () => {
    for (const bad of [
      { CLEARINGHOUSE_SECRET_KEY: 'short' },
      { CLEARINGHOUSE_PREVIOUS_SECRET_KEYS: `${KEY},short` }
    ]) {
      assert.throws(
        () => parseConfig({ ...rawEnv, ...bad }),
        /Use 32 random bytes, base64 encoded \(openssl rand -base64 32\)/
      );
    }
  });

  it('rejects an env missing any required variable', () => {
    for (const key of Object.keys(rawEnv)) {
      assert.throws(() => parseConfig({ ...rawEnv, [key]: undefined }), { name: 'ValiError' }, key);
    }
  });

  it('rejects an unknown NODE_ENV', () => {
    assert.throws(() => parseConfig({ ...rawEnv, NODE_ENV: 'staging' }), { name: 'ValiError' });
  });

  it('rejects ports outside 1..65535 and accepts the bounds', () => {
    for (const port of ['http', '0', '65536', '30.5']) {
      assert.throws(() => parseConfig({ ...rawEnv, API_PORT: port }), { name: 'ValiError' }, port);
    }
    assert.equal(parseConfig({ ...rawEnv, API_PORT: '1' }).API_PORT, 1);
    assert.equal(parseConfig({ ...rawEnv, API_PORT: '65535' }).API_PORT, 65535);
  });

  it('rejects sizes and pool limits below one', () => {
    for (const bad of [
      { API_MAX_BODY_BYTES: '0' },
      { API_MAX_IMPORT_BYTES: '1.5' },
      { API_DB_POOL_MAX: '-1' }
    ]) {
      assert.throws(
        () => parseConfig({ ...rawEnv, ...bad }),
        { name: 'ValiError' },
        JSON.stringify(bad)
      );
    }
  });

  it('rejects non-URL endpoints', () => {
    for (const key of ['SSE_URL', 'WEB_URL', 'S3_ENDPOINT', 'SFTP_S3_ENDPOINT', 'EMBEDDINGS_URL']) {
      assert.throws(
        () => parseConfig({ ...rawEnv, [key]: 'not a url' }),
        { name: 'ValiError' },
        key
      );
    }
  });

  it('needs a hook secret of at least 32 characters', () => {
    assert.throws(() => parseConfig({ ...rawEnv, SFTP_HOOK_SECRET: 'x'.repeat(31) }), {
      name: 'ValiError'
    });
  });
});
