import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseConfig } from './config.ts';

describe('migrations parseConfig', () => {
  it('parses valid db config and rejects missing vars', () => {
    const config = parseConfig({
      DB_HOST: 'localhost',
      DB_PORT: '5432',
      DB_USER: 'ugula',
      DB_PASSWORD: 'secret',
      DB_NAME: 'ugula'
    });
    assert.equal(config.DB_PORT, 5432);
    assert.throws(() => parseConfig({}));
  });
});
