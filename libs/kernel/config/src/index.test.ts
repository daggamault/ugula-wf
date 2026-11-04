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
  it('validates primitive schemas and rejects invalid values', () => {
    assert.equal(v.parse(nonEmpty, 'ok'), 'ok');
    assert.throws(() => v.parse(nonEmpty, ''));

    assert.equal(v.parse(portInt, '5432'), 5432);
    assert.equal(v.parse(portInt, '1'), 1);
    assert.equal(v.parse(portInt, '65535'), 65535);
    for (const bad of ['', '0', '65536', '80.5', 'http']) {
      assert.throws(() => v.parse(portInt, bad), bad);
    }

    assert.equal(v.parse(posInt, '10'), 10);
    for (const bad of ['', '0', '-1', '1.5', 'ten']) {
      assert.throws(() => v.parse(posInt, bad), bad);
    }

    assert.equal(v.parse(urlString, 'http://localhost:3000'), 'http://localhost:3000');
    assert.throws(() => v.parse(urlString, 'not-a-url'));

    assert.equal(v.parse(emailString, '  Dev@Example.com '), 'dev@example.com');
    assert.throws(() => v.parse(emailString, 'invalid'));

    assert.equal(v.parse(nodeEnvSchema, 'production'), 'production');
    assert.throws(() => v.parse(nodeEnvSchema, 'staging'));
  });

  it('validates db and redis env entry shapes', () => {
    const dbSchema = v.object(dbEnvEntries);
    const redisSchema = v.object(redisEnvEntries);

    const db = v.parse(dbSchema, {
      DB_HOST: 'localhost',
      DB_PORT: '5432',
      DB_USER: 'ugula',
      DB_PASSWORD: 'secret',
      DB_NAME: 'ugula'
    });
    assert.equal(db.DB_PORT, 5432);

    const redis = v.parse(redisSchema, {
      REDIS_HOST: 'localhost',
      REDIS_PORT: '6379',
      REDIS_PASSWORD: 'secret'
    });
    assert.equal(redis.REDIS_PORT, 6379);
    assert.throws(() => v.parse(dbSchema, { ...db, DB_PORT: '5432', DB_PASSWORD: '' }));
    assert.throws(() => v.parse(redisSchema, { REDIS_HOST: 'localhost', REDIS_PORT: '6379' }));

    const s3 = v.parse(v.object(s3EnvEntries), {
      S3_ENDPOINT: 'http://localhost:9000',
      S3_REGION: 'us-east-1',
      S3_BUCKET: 'ugula',
      S3_ACCESS_KEY_ID: 'key',
      S3_SECRET_ACCESS_KEY: 'secret'
    });
    assert.equal(s3.S3_BUCKET, 'ugula');
    assert.throws(() => v.parse(v.object(s3EnvEntries), { ...s3, S3_ENDPOINT: 'nope' }));

    const inference = v.parse(v.object(inferenceEnvEntries), {
      EMBEDDINGS_URL: 'http://localhost:8080',
      COMPLETIONS_URL: 'http://localhost:8081',
      COMPLETIONS_MODEL: 'qwen'
    });
    assert.equal(inference.COMPLETIONS_MODEL, 'qwen');
    assert.throws(() =>
      v.parse(v.object(inferenceEnvEntries), { ...inference, EMBEDDINGS_URL: 'nope' })
    );
  });

  it('accepts a 32 byte base64 secret key, or none', () => {
    const schema = v.object(secretKeyEnvEntries);
    const key = Buffer.alloc(32, 7).toString('base64');
    assert.equal(
      v.parse(schema, { CLEARINGHOUSE_SECRET_KEY: ` ${key} ` }).CLEARINGHOUSE_SECRET_KEY,
      key
    );
    assert.equal(v.parse(schema, {}).CLEARINGHOUSE_SECRET_KEY, undefined);
    assert.equal(v.parse(schema, { CLEARINGHOUSE_SECRET_KEY: '' }).CLEARINGHOUSE_SECRET_KEY, '');
    assert.throws(() => v.parse(schema, { CLEARINGHOUSE_SECRET_KEY: 'short' }), /openssl rand/);
  });
});
