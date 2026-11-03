import { emailString, nonEmpty } from '@ugula/config';
import * as v from 'valibot';

export const e2eConfigSchema = v.object({
  DEV_USER_EMAIL: emailString,
  DEV_USER_PASSWORD: nonEmpty,
  E2E_WEB_URL: v.optional(v.pipe(v.string(), v.url()), 'http://localhost:3000'),
  E2E_BROWSER_CHANNEL: v.optional(v.picklist(['msedge', 'chrome', 'chromium']), 'msedge'),
  E2E_STEP_MS: v.optional(
    v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1_000)),
    '15000'
  ),
  E2E_FLOW_MS: v.optional(
    v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1_000)),
    '300000'
  )
});

export type E2eConfig = v.InferOutput<typeof e2eConfigSchema>;

export const parseE2eConfig = (raw: Record<string, string | undefined>): E2eConfig =>
  v.parse(e2eConfigSchema, raw);

export const config = parseE2eConfig(process.env);

export const withPcr = (xml: string, pcr: string) => xml.replaceAll('E2E-PCR', pcr);
