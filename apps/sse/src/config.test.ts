import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseConfig } from './config.ts';

describe('sse parseConfig', () => {
  it('parses valid env and rejects missing vars', () => {
    const config = parseConfig({
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
    });
    assert.equal(config.SSE_PORT, 3002);
    assert.equal(config.DB_PORT, 5432);
    assert.equal(config.REDIS_PORT, 6379);
    assert.throws(() => parseConfig({ SSE_PORT: '3002' }));
  });
});
