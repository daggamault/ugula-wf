import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseMockConfig } from './mock-config.ts';

const required = {
  CLEARINGHOUSE_SFTP_PORT: '2223',
  CLEARINGHOUSE_SFTP_USERNAME: 'ugula',
  CLEARINGHOUSE_SFTP_PASSWORD: 'secret'
};

describe('parseMockConfig', () => {
  it('defaults the host, remit delay and real-time port', () => {
    assert.deepEqual(parseMockConfig(required), {
      host: 'localhost',
      port: 2223,
      credentials: { username: 'ugula', password: 'secret' },
      remitDelayMs: 20_000,
      realtimePort: 2224,
      eraUnenrolled: new Set()
    });
  });

  it('reads the payers without ERA enrollment as trimmed upper-case IDs', () => {
    const c = parseMockConfig({
      ...required,
      CLEARINGHOUSE_REMIT_DELAY_SECONDS: '0',
      CLEARINGHOUSE_ERA_UNENROLLED: ' mcr, ,bcbs '
    });
    assert.equal(c.remitDelayMs, 0);
    assert.deepEqual(c.eraUnenrolled, new Set(['MCR', 'BCBS']));
  });

  it('requires the SFTP port and credentials and a non-empty host', () => {
    assert.throws(() => parseMockConfig({ ...required, CLEARINGHOUSE_SFTP_PASSWORD: '' }));
    assert.throws(() => parseMockConfig({ ...required, CLEARINGHOUSE_SFTP_PORT: undefined }));
    assert.throws(() => parseMockConfig({ ...required, CLEARINGHOUSE_SFTP_HOST: '' }));
  });
});
