import { dbEnvEntries } from '@ugula/config';
import * as v from 'valibot';

const configSchema = v.object(dbEnvEntries);

type Config = v.InferOutput<typeof configSchema>;

export const parseConfig = (raw: Record<string, string | undefined>): Config =>
  v.parse(configSchema, raw);
