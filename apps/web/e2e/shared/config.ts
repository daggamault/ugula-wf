import { createHash } from 'node:crypto';
import { emailString, nonEmpty } from '@ugula/config';
import * as v from 'valibot';

const e2eConfigSchema = v.object({
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

type E2eConfig = v.InferOutput<typeof e2eConfigSchema>;

const parseE2eConfig = (raw: Record<string, string | undefined>): E2eConfig =>
  v.parse(e2eConfigSchema, raw);

export const config = parseE2eConfig(process.env);

const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.toUpperCase();

let issued = 0;

export const uniqueId = (prefix: string) => `${prefix}-${RUN}-${++issued}`;

const digest = (seed: string) => createHash('sha256').update(seed).digest();

const lettersOf = (seed: string, n: number) =>
  [...digest(seed).subarray(0, n)].map((b) => String.fromCharCode(97 + (b % 26))).join('');

const ALNUM = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';

const alnumOf = (seed: string, n: number) =>
  [...digest(`id:${seed}`).subarray(0, n)].map((b) => ALNUM[b % ALNUM.length]).join('');

const MEMBER_TAIL = 5;

export type PatientOptions = {
  seed?: string;
  memberPrefix?: string;
  payers?: Readonly<Record<string, { name: string; code: string }>>;
};

export const nameTag = (seed: string) => {
  const letters = lettersOf(seed, 12);
  return `${letters.slice(0, 1).toUpperCase()}${letters.slice(1)}`;
};

export const tagged = (seed: string, name: string) => `${nameTag(seed)}-${name}`;

export const withPcr = (xml: string, pcr: string) =>
  xml.replace(
    /<eRecord\.01>PCR-\d+(-\d+)?<\/eRecord\.01>/g,
    (_, part = '') => `<eRecord.01>${pcr}${part}</eRecord.01>`
  );

const NAMES = /<(ePatient\.0[23]|ePayment\.19|ePayment\.20|eOther\.2[01])>([^<]+)<\/\1>/g;

const DAY_MS = 86_400_000;

const shiftedBirth = (seed: string, date: string) => {
  const [a = 0, b = 0] = digest(`birth:${seed}`);
  const days = 1 + ((a * 256 + b) % 360);
  return new Date(Date.parse(`${date}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);
};

const memberId = (seed: string, id: string, prefix?: string) =>
  prefix
    ? `${prefix}${alnumOf(`${seed}:${id}`, 6)}`
    : `${id.slice(0, -MEMBER_TAIL)}${alnumOf(`${seed}:${id}`, MEMBER_TAIL)}`;

const renamePayer = (xml: string, from: string, to: { name: string; code: string }) =>
  xml.replace(
    new RegExp(`<ePayment\\.09>[^<]*</ePayment\\.09>(\\s*)<ePayment\\.10>${from}</ePayment\\.10>`),
    `<ePayment.09>${to.code}</ePayment.09>$1<ePayment.10>${to.name}</ePayment.10>`
  );

export const withPatient = (xml: string, pcr: string, o: PatientOptions = {}) => {
  const seed = o.seed ?? pcr;
  return Object.entries(o.payers ?? {})
    .reduce((x, [from, to]) => renamePayer(x, from, to), xml)
    .replace(NAMES, (_, el, name) => `<${el}>${tagged(seed, name)}</${el}>`)
    .replace(
      /<ePatient\.17>(\d{4}-\d{2}-\d{2})<\/ePatient\.17>/g,
      (_, date: string) => `<ePatient.17>${shiftedBirth(seed, date)}</ePatient.17>`
    )
    .replace(
      /<ePayment\.18>([^<]+)<\/ePayment\.18>/g,
      (_, id: string) => `<ePayment.18>${memberId(seed, id, o.memberPrefix)}</ePayment.18>`
    );
};
