import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseConfig } from './config.ts';

const env = {
  SSE_PORT: '3002',
  HTTP_CORS_ORIGINS: 'http://localhost:3000',
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
  it('parses valid env and rejects missing vars', () => {
    const config = parseConfig(env);
    assert.equal(config.SSE_PORT, 3002);
    assert.equal(config.DB_PORT, 5432);
    assert.equal(config.REDIS_PORT, 6379);
    assert.throws(() => parseConfig({ SSE_PORT: '3002' }));
    assert.throws(() => parseConfig({ ...env, SSE_PORT: 'http' }));
    assert.throws(() => parseConfig({ ...env, HTTP_CORS_ORIGINS: '' }));
  });
});
