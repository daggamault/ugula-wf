import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseDbConfig, parseDevSeedConfig } from './config.ts';

describe('seed parseConfig', () => {
  it('parses db and dev seed configs', () => {
    const db = parseDbConfig({
      DB_HOST: 'localhost',
      DB_PORT: '5432',
      DB_USER: 'ugula',
      DB_PASSWORD: 'secret',
      DB_NAME: 'ugula'
    });
    assert.equal(db.DB_PORT, 5432);

    const dev = parseDevSeedConfig({
      DEV_USER_EMAIL: 'Admin@Example.com',
      DEV_USER_PASSWORD: 'P@ssw0rd123',
      DEV_SFTP_USERNAME: 'acme',
      DEV_SFTP_PASSWORD: 'P@ssw0rd123'
    });
    assert.equal(dev.DEV_USER_EMAIL, 'admin@example.com');
    assert.throws(() => parseDevSeedConfig({}));
  });
});
