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
