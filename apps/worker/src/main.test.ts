import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PgBoss } from 'pg-boss';
import type { Config } from './config.ts';
import { createWorker } from './main.ts';

describe('worker createWorker', () => {
  it('creates a PgBoss instance from parsed config', () => {
    const boss = createWorker({
      DB_HOST: 'localhost',
      DB_PORT: 5432,
      DB_USER: 'ugula',
      DB_PASSWORD: 'password',
      DB_NAME: 'ugula'
    } as Config);
    assert.ok(boss instanceof PgBoss);
  });
});
