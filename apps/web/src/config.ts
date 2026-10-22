import { urlString } from '@ugula/config';
import * as v from 'valibot';

export const configSchema = v.object({
  apiUrl: urlString
});

export type Config = v.InferOutput<typeof configSchema>;

export const parseConfig = (doc: Pick<Document, 'querySelector'>): Config =>
  v.parse(configSchema, {
    apiUrl: doc.querySelector('meta[name="api-url"]')?.getAttribute('content')
  });
