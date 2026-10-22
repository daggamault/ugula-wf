import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseConfig } from './config.ts';

const rawEnv = {
  NODE_ENV: 'test',
  API_PORT: '3001',
  SSE_URL: 'http://localhost:3002',
  HTTP_CORS_ORIGINS: 'http://localhost:3000',
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_USER: 'ugula',
  DB_PASSWORD: 'secret',
  DB_NAME: 'ugula',
  API_DB_POOL_MAX: '20',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
  REDIS_PASSWORD: 'secret'
};

describe('api parseConfig', () => {
  it('parses valid env and rejects missing vars', () => {
    const config = parseConfig(rawEnv);
    assert.equal(config.API_PORT, 3001);
    assert.equal(config.DB_PORT, 5432);
    assert.equal(config.REDIS_PORT, 6379);
    assert.throws(() => parseConfig({}));
  });
});
