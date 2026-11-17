import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clearinghouseOf, parseConfig } from './config.ts';

const HOST_KEY = `SHA256:${'b'.repeat(43)}`;

const rawEnv = {
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_USER: 'ugula',
  DB_PASSWORD: 'password',
  DB_NAME: 'ugula',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
  REDIS_PASSWORD: 'secret',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'ugula',
  S3_ACCESS_KEY: 'key',
  S3_SECRET_KEY: 'secret',
  EMBEDDINGS_URL: 'http://localhost:8080',
  COMPLETIONS_URL: 'http://localhost:8081',
  COMPLETIONS_MODEL: 'qwen'
};

describe('worker parseConfig', () => {
  it('parses valid env, defaults workflow concurrency, and rejects missing vars', () => {
    const config = parseConfig(rawEnv);
    assert.equal(config.DB_PORT, 5432);
    assert.equal(config.WORKER_RUN_CONCURRENCY, 8);
    assert.equal(parseConfig({ ...rawEnv, WORKER_RUN_CONCURRENCY: '2' }).WORKER_RUN_CONCURRENCY, 2);
    assert.throws(() => parseConfig({}));
    assert.throws(() => parseConfig({ ...rawEnv, WORKER_RUN_CONCURRENCY: '0' }));
    assert.throws(() => parseConfig({ ...rawEnv, COMPLETIONS_URL: undefined }));
  });

  it('defaults load limits to 90% event loop and the heap limit, and bounds utilization', () => {
    const config = parseConfig(rawEnv);
    assert.equal(config.WORKER_MAX_EVENT_LOOP_UTILIZATION, 0.9);
    assert.equal(config.WORKER_MAX_HEAP_MB, undefined);
    assert.equal(config.WORKER_MAX_RSS_MB, undefined);
    const set = parseConfig({
      ...rawEnv,
      WORKER_MAX_EVENT_LOOP_UTILIZATION: '0.75',
      WORKER_MAX_HEAP_MB: '1536',
      WORKER_MAX_RSS_MB: '3072'
    });
    assert.deepEqual(
      [set.WORKER_MAX_EVENT_LOOP_UTILIZATION, set.WORKER_MAX_HEAP_MB, set.WORKER_MAX_RSS_MB],
      [0.75, 1536, 3072]
    );
    assert.throws(() => parseConfig({ ...rawEnv, WORKER_MAX_EVENT_LOOP_UTILIZATION: '1.5' }));
    assert.throws(() => parseConfig({ ...rawEnv, WORKER_MAX_EVENT_LOOP_UTILIZATION: 'busy' }));
  });

  it('reads the clearinghouse SFTP connection, off unless a host is set', () => {
    assert.equal(clearinghouseOf(parseConfig(rawEnv)), null);
    const on = clearinghouseOf(
      parseConfig({
        ...rawEnv,
        CLEARINGHOUSE_SFTP_HOST: 'sftp.example.com',
        CLEARINGHOUSE_SFTP_USERNAME: 'agency',
        CLEARINGHOUSE_SFTP_PASSWORD: 'secret',
        CLEARINGHOUSE_SFTP_HOST_KEY: HOST_KEY,
        CLEARINGHOUSE_DOWNLOAD_PATHS: '/outbound/999, /outbound/835',
        CLEARINGHOUSE_CLAIM_EXTENSION: '.CLP',
        CLEARINGHOUSE_ELIGIBILITY_EXTENSION: '.ELG',
        CLEARINGHOUSE_REALTIME_URL: 'http://localhost:2224/core/realtime'
      })
    );
    assert.deepEqual(on, {
      host: 'sftp.example.com',
      port: 22,
      username: 'agency',
      password: 'secret',
      hostKey: HOST_KEY,
      uploadPath: '/',
      downloadPaths: ['/outbound/999', '/outbound/835'],
      extensions: { claims: '.CLP', eligibility: '.ELG', claimStatus: '.txt' },
      afterDownload: 'delete',
      realtimeUrl: 'http://localhost:2224/core/realtime'
    });
    const config = parseConfig(rawEnv);
    assert.deepEqual(
      [config.CLEARINGHOUSE_POLL_MINUTES, config.CLEARINGHOUSE_REALTIME_TIMEOUT_SECONDS],
      [1, 30]
    );
    assert.throws(() => parseConfig({ ...rawEnv, CLEARINGHOUSE_REALTIME_URL: 'nope' }));
    assert.throws(() => parseConfig({ ...rawEnv, CLEARINGHOUSE_SECRET_KEY: 'short' }));
    assert.throws(
      () => parseConfig({ ...rawEnv, CLEARINGHOUSE_SFTP_HOST: 'sftp.example.com' }),
      /are required with CLEARINGHOUSE_SFTP_HOST/
    );
    const unpinned = {
      ...rawEnv,
      CLEARINGHOUSE_SFTP_HOST: 'sftp.example.com',
      CLEARINGHOUSE_SFTP_USERNAME: 'agency',
      CLEARINGHOUSE_SFTP_PASSWORD: 'secret'
    };
    assert.throws(() => parseConfig(unpinned), /CLEARINGHOUSE_SFTP_HOST_KEY/);
    assert.throws(() => parseConfig({ ...unpinned, CLEARINGHOUSE_SFTP_HOST_KEY: 'ab:cd' }));
    assert.throws(() => parseConfig({ ...rawEnv, CLEARINGHOUSE_DOWNLOAD_PATHS: 'outbound' }));
    assert.throws(() => parseConfig({ ...rawEnv, CLEARINGHOUSE_CLAIM_EXTENSION: 'xtxt' }));
    assert.throws(() => parseConfig({ ...rawEnv, CLEARINGHOUSE_POLL_MINUTES: '60' }));
  });

  const sftp = {
    ...rawEnv,
    CLEARINGHOUSE_SFTP_HOST: ' sftp.example.com ',
    CLEARINGHOUSE_SFTP_PORT: '2222',
    CLEARINGHOUSE_SFTP_USERNAME: 'agency',
    CLEARINGHOUSE_SFTP_PASSWORD: 'secret',
    CLEARINGHOUSE_SFTP_HOST_KEY: ` ${HOST_KEY} `
  };

  it('defaults a connection to the root folders, .txt files, deleting downloads and no realtime URL', () => {
    assert.deepEqual(clearinghouseOf(parseConfig(sftp)), {
      host: 'sftp.example.com',
      port: 2222,
      username: 'agency',
      password: 'secret',
      hostKey: HOST_KEY,
      uploadPath: '/',
      downloadPaths: ['/'],
      extensions: { claims: '.txt', eligibility: '.txt', claimStatus: '.txt' },
      afterDownload: 'delete',
      realtimeUrl: null
    });
  });

  it('reads the upload folder, kept downloads and the status extension, trimming paths', () => {
    const on = clearinghouseOf(
      parseConfig({
        ...sftp,
        CLEARINGHOUSE_UPLOAD_PATH: ' /inbound ',
        CLEARINGHOUSE_DOWNLOAD_PATHS: '/outbound,,',
        CLEARINGHOUSE_STATUS_EXTENSION: '.277',
        CLEARINGHOUSE_AFTER_DOWNLOAD: 'keep'
      })
    );
    assert.deepEqual(
      [on?.uploadPath, on?.downloadPaths, on?.extensions.claimStatus, on?.afterDownload],
      ['/inbound', ['/outbound'], '.277', 'keep']
    );
  });

  it('leaves the connection off for a blank host and needs every credential for a set one', () => {
    assert.equal(clearinghouseOf(parseConfig({ ...rawEnv, CLEARINGHOUSE_SFTP_HOST: '  ' })), null);
    for (const missing of ['CLEARINGHOUSE_SFTP_USERNAME', 'CLEARINGHOUSE_SFTP_PASSWORD']) {
      assert.throws(
        () => parseConfig({ ...sftp, [missing]: '' }),
        /CLEARINGHOUSE_SFTP_USERNAME, CLEARINGHOUSE_SFTP_PASSWORD and CLEARINGHOUSE_SFTP_HOST_KEY are required with CLEARINGHOUSE_SFTP_HOST/
      );
    }
  });

  it('rejects out-of-range ports, timeouts, utilization and folders, and accepts the bounds', () => {
    for (const bad of [
      { CLEARINGHOUSE_SFTP_PORT: '0' },
      { CLEARINGHOUSE_SFTP_PORT: '65536' },
      { CLEARINGHOUSE_REALTIME_TIMEOUT_SECONDS: '301' },
      { CLEARINGHOUSE_POLL_MINUTES: '0' },
      { CLEARINGHOUSE_UPLOAD_PATH: 'inbound' },
      { CLEARINGHOUSE_DOWNLOAD_PATHS: ' , ' },
      { CLEARINGHOUSE_AFTER_DOWNLOAD: 'archive' },
      { WORKER_MAX_EVENT_LOOP_UTILIZATION: '0.05' }
    ]) {
      assert.throws(
        () => parseConfig({ ...sftp, ...bad }),
        { name: 'ValiError' },
        JSON.stringify(bad)
      );
    }
    const edge = parseConfig({
      ...sftp,
      CLEARINGHOUSE_REALTIME_TIMEOUT_SECONDS: '300',
      CLEARINGHOUSE_POLL_MINUTES: '59',
      WORKER_MAX_EVENT_LOOP_UTILIZATION: '0.1'
    });
    assert.deepEqual(
      [
        edge.CLEARINGHOUSE_REALTIME_TIMEOUT_SECONDS,
        edge.CLEARINGHOUSE_POLL_MINUTES,
        edge.WORKER_MAX_EVENT_LOOP_UTILIZATION
      ],
      [300, 59, 0.1]
    );
  });
});
