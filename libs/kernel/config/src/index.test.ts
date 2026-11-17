import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import {
  dbEnvEntries,
  emailString,
  inferenceEnvEntries,
  nodeEnvSchema,
  nonEmpty,
  portInt,
  posInt,
  redisEnvEntries,
  s3EnvEntries,
  secretKeyEnvEntries,
  urlString
} from './index.ts';

describe('config primitives', () => {
  it('requires a non-empty string', () => {
    assert.equal(v.parse(nonEmpty, 'ok'), 'ok');
    assert.throws(() => v.parse(nonEmpty, ''));
    assert.throws(() => v.parse(nonEmpty, undefined));
  });

  it('reads a port between 1 and 65535 as a number', () => {
    assert.equal(v.parse(portInt, '5432'), 5432);
    assert.equal(v.parse(portInt, '1'), 1);
    assert.equal(v.parse(portInt, '65535'), 65535);
    for (const bad of ['', '0', '65536', '80.5', 'http', '-1']) {
      assert.throws(() => v.parse(portInt, bad), bad);
    }
  });

  it('reads a positive integer as a number', () => {
    assert.equal(v.parse(posInt, '1'), 1);
    assert.equal(v.parse(posInt, '100000'), 100000);
    for (const bad of ['', '0', '-1', '1.5', 'ten']) {
      assert.throws(() => v.parse(posInt, bad), bad);
    }
  });

  it('requires a URL', () => {
    assert.equal(v.parse(urlString, 'http://localhost:3000'), 'http://localhost:3000');
    assert.throws(() => v.parse(urlString, 'not-a-url'));
    assert.throws(() => v.parse(urlString, ''));
  });

  it('trims and lowercases an email', () => {
    assert.equal(v.parse(emailString, '  Dev@Example.com '), 'dev@example.com');
    assert.throws(() => v.parse(emailString, 'invalid'));
    assert.throws(() => v.parse(emailString, ''));
  });

  it('accepts only the known node environments', () => {
    for (const env of ['development', 'production', 'test']) {
      assert.equal(v.parse(nodeEnvSchema, env), env);
    }
    assert.throws(() => v.parse(nodeEnvSchema, 'staging'));
  });
});

describe('config entries', () => {
  it('reads the database settings with a numeric port', () => {
    const schema = v.object(dbEnvEntries);
    const env = {
      DB_HOST: 'localhost',
      DB_PORT: '5432',
      DB_USER: 'ugula',
      DB_PASSWORD: 'secret',
      DB_NAME: 'ugula'
    };
    assert.deepEqual(v.parse(schema, env), { ...env, DB_PORT: 5432 });
    assert.throws(() => v.parse(schema, { ...env, DB_PASSWORD: '' }));
    assert.throws(() => v.parse(schema, { ...env, DB_PORT: '0' }));
  });

  it('reads the redis settings and requires a password', () => {
    const schema = v.object(redisEnvEntries);
    const env = { REDIS_HOST: 'localhost', REDIS_PORT: '6379', REDIS_PASSWORD: 'secret' };
    assert.deepEqual(v.parse(schema, env), { ...env, REDIS_PORT: 6379 });
    assert.throws(() => v.parse(schema, { REDIS_HOST: 'localhost', REDIS_PORT: '6379' }));
  });

  it('reads the S3 settings and requires an endpoint URL', () => {
    const schema = v.object(s3EnvEntries);
    const env = {
      S3_ENDPOINT: 'http://localhost:9000',
      S3_REGION: 'us-east-1',
      S3_BUCKET: 'ugula',
      S3_ACCESS_KEY: 'key',
      S3_SECRET_KEY: 'secret'
    };
    assert.deepEqual(v.parse(schema, env), env);
    assert.throws(() => v.parse(schema, { ...env, S3_ENDPOINT: 'nope' }));
  });

  it('reads the inference settings and requires both URLs', () => {
    const schema = v.object(inferenceEnvEntries);
    const env = {
      EMBEDDINGS_URL: 'http://localhost:8080',
      COMPLETIONS_URL: 'http://localhost:8081',
      COMPLETIONS_MODEL: 'qwen'
    };
    assert.deepEqual(v.parse(schema, env), env);
    assert.throws(() => v.parse(schema, { ...env, EMBEDDINGS_URL: 'nope' }));
    assert.throws(() => v.parse(schema, { ...env, COMPLETIONS_URL: 'nope' }));
  });

  it('accepts a trimmed 32 byte base64 secret key, an empty one, or none', () => {
    const schema = v.object(secretKeyEnvEntries);
    const key = Buffer.alloc(32, 7).toString('base64');
    const secret = (raw?: string) =>
      v.parse(schema, { CLEARINGHOUSE_SECRET_KEY: raw }).CLEARINGHOUSE_SECRET_KEY;
    assert.equal(secret(` ${key} `), key);
    assert.equal(secret(), undefined);
    assert.equal(secret(''), '');
    assert.equal(secret('   '), '');
  });

  it('rejects a secret key that is not 32 bytes of base64', () => {
    const schema = v.object(secretKeyEnvEntries);
    for (const bad of [
      'short',
      Buffer.alloc(31, 7).toString('base64'),
      Buffer.alloc(33, 7).toString('base64'),
      `${'-'.repeat(43)}=`
    ]) {
      assert.throws(() => v.parse(schema, { CLEARINGHOUSE_SECRET_KEY: bad }), /openssl rand/, bad);
    }
  });

  it('reads previous secret keys as a comma separated list, skipping blanks', () => {
    const schema = v.object(secretKeyEnvEntries);
    const [a, b] = [Buffer.alloc(32, 1), Buffer.alloc(32, 2)].map((k) => k.toString('base64'));
    const previous = (raw?: string) =>
      v.parse(schema, { CLEARINGHOUSE_PREVIOUS_SECRET_KEYS: raw })
        .CLEARINGHOUSE_PREVIOUS_SECRET_KEYS;
    assert.deepEqual(previous(` ${a} , ${b},`), [a, b]);
    assert.deepEqual(previous(' , ,'), []);
    assert.deepEqual(previous(''), []);
    assert.deepEqual(previous(), []);
    assert.throws(() => previous(`${a},short`), /openssl rand/);
  });
});
