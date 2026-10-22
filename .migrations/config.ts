import { dbEnvEntries } from '@ugula/config';
import * as v from 'valibot';

export const configSchema = v.object(dbEnvEntries);

export type Config = v.InferOutput<typeof configSchema>;

export const parseConfig = (raw: Record<string, string | undefined>): Config =>
  v.parse(configSchema, raw);
