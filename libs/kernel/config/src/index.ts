import * as v from 'valibot';

export const nonEmpty = v.pipe(v.string(), v.nonEmpty());

export const portInt = v.pipe(
  nonEmpty,
  v.transform(Number),
  v.number(),
  v.integer(),
  v.minValue(1),
  v.maxValue(65535)
);

export const posInt = v.pipe(nonEmpty, v.transform(Number), v.number(), v.integer(), v.minValue(1));

export const urlString = v.pipe(nonEmpty, v.url());

export const emailString = v.pipe(nonEmpty, v.trim(), v.toLowerCase(), v.email());

export const nodeEnvSchema = v.picklist(['development', 'production', 'test']);

export const dbEnvEntries = {
  DB_HOST: nonEmpty,
  DB_PORT: portInt,
  DB_USER: nonEmpty,
  DB_PASSWORD: nonEmpty,
  DB_NAME: nonEmpty
} as const;

export const redisEnvEntries = {
  REDIS_HOST: nonEmpty,
  REDIS_PORT: portInt,
  REDIS_PASSWORD: nonEmpty
} as const;

export const s3EnvEntries = {
  S3_ENDPOINT: urlString,
  S3_REGION: nonEmpty,
  S3_BUCKET: nonEmpty,
  S3_ACCESS_KEY_ID: nonEmpty,
  S3_SECRET_ACCESS_KEY: nonEmpty
} as const;

export const inferenceEnvEntries = {
  EMBEDDINGS_URL: urlString,
  COMPLETIONS_URL: urlString,
  COMPLETIONS_MODEL: nonEmpty
} as const;

const SECRET_KEY = /^[A-Za-z0-9+/]{43}=$/;

const SECRET_KEY_HINT = 'Use 32 random bytes, base64 encoded (openssl rand -base64 32)';

export const secretKeyEnvEntries = {
  CLEARINGHOUSE_SECRET_KEY: v.optional(
    v.pipe(
      v.string(),
      v.trim(),
      v.check((s) => s === '' || SECRET_KEY.test(s), SECRET_KEY_HINT)
    )
  ),
  CLEARINGHOUSE_PREVIOUS_SECRET_KEYS: v.optional(
    v.pipe(
      v.string(),
      v.transform((s) =>
        s
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean)
      ),
      v.check((keys) => keys.every((k) => SECRET_KEY.test(k)), SECRET_KEY_HINT)
    ),
    ''
  )
} as const;
