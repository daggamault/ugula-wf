import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseE2eConfig, withPcr } from './config.ts';

describe('e2e config', () => {
  it('defaults to the local web app and Edge, and needs the dev user', () => {
    assert.deepEqual(
      parseE2eConfig({ DEV_USER_EMAIL: 'dev@example.com', DEV_USER_PASSWORD: 'x' }),
      {
        DEV_USER_EMAIL: 'dev@example.com',
        DEV_USER_PASSWORD: 'x',
        E2E_WEB_URL: 'http://localhost:3000',
        E2E_BROWSER_CHANNEL: 'msedge'
      }
    );
    assert.throws(() => parseE2eConfig({}));
  });

  it('gives every run its own PCR number', () => {
    assert.equal(
      withPcr('<eRecord.01>E2E-PCR</eRecord.01>', 'E2E-1'),
      '<eRecord.01>E2E-1</eRecord.01>'
    );
  });
});
