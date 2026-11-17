import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseConfig } from './config.ts';

const env = {
  SSE_PORT: '3002',
  SSE_CORS_ORIGINS: 'http://localhost:3000',
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_USER: 'ugula',
  DB_PASSWORD: 'secret',
  DB_NAME: 'ugula',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
  REDIS_PASSWORD: 'secret'
};

describe('sse parseConfig', () => {
  it('parses a valid env, turning ports into numbers', () => {
    assert.deepEqual(parseConfig(env), {
      SSE_PORT: 3002,
      SSE_CORS_ORIGINS: 'http://localhost:3000',
      DB_HOST: 'localhost',
      DB_PORT: 5432,
      DB_USER: 'ugula',
      DB_PASSWORD: 'secret',
      DB_NAME: 'ugula',
      REDIS_HOST: 'localhost',
      REDIS_PORT: 6379,
      REDIS_PASSWORD: 'secret'
    });
  });

  it('drops variables it does not know', () => {
    assert.equal('NODE_ENV' in parseConfig({ ...env, NODE_ENV: 'test' }), false);
  });

  it('rejects an env missing any required variable', () => {
    for (const key of Object.keys(env)) {
      assert.throws(() => parseConfig({ ...env, [key]: undefined }), { name: 'ValiError' }, key);
    }
  });

  it('rejects empty strings', () => {
    for (const key of ['SSE_CORS_ORIGINS', 'DB_HOST', 'DB_PASSWORD', 'REDIS_PASSWORD']) {
      assert.throws(() => parseConfig({ ...env, [key]: '' }), { name: 'ValiError' }, key);
    }
  });

  it('rejects ports that are not integers in 1..65535 and accepts the bounds', () => {
    for (const port of ['http', '0', '65536', '30.5']) {
      assert.throws(() => parseConfig({ ...env, SSE_PORT: port }), { name: 'ValiError' }, port);
    }
    assert.throws(() => parseConfig({ ...env, DB_PORT: '0' }));
    assert.throws(() => parseConfig({ ...env, REDIS_PORT: 'redis' }));
    assert.equal(parseConfig({ ...env, SSE_PORT: '1' }).SSE_PORT, 1);
    assert.equal(parseConfig({ ...env, SSE_PORT: '65535' }).SSE_PORT, 65535);
  });
});
