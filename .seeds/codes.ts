import { gunzipSync } from 'node:zlib';
import { type CodeSet, isCodeSet } from '@ugula/billing';
import type { Database } from '@ugula/db';
import type { Kysely } from 'kysely';

export type Code = { set: CodeSet; code: string; description: string };

export const ICD10CM_YEAR = 2027;

export const ICD10CM_URL = `https://www.cms.gov/files/zip/${ICD10CM_YEAR}-code-descriptions-tabular-order.zip`;

export const HCPCS_URL = 'https://www.cms.gov/files/zip/october-2026-alpha-numeric-hcpcs-file.zip';

export const CARC_URL = 'https://x12.org/codes/claim-adjustment-reason-codes';

export const RARC_URL = 'https://x12.org/codes/remittance-advice-remark-codes';

export const POS_URL =
  'https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets';

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  ndash: '–',
  mdash: '—'
};

const decode = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&(\w+);/g, (m, name: string) => ENTITIES[name] ?? m);

const clean = (text: string) => text.replace(/\s+/g, ' ').trim();

const isCode = (code: string) => /^[A-Z0-9]{1,7}$/.test(code);

const codeOf = (set: CodeSet, code: string, description: string): Code[] => {
  const c = clean(code).toUpperCase();
  const d = clean(description);
  return isCode(c) && d ? [{ set, code: c, description: d }] : [];
};

export const parseIcd10cm = (text: string): Code[] =>
  text.split(/\r?\n/).flatMap((line) => codeOf('icd10cm', line.slice(0, 8), line.slice(8)));

const AMBULANCE = /^A0\d{3}$/;

export const parseHcpcs = (text: string): Code[] => {
  const records = new Map<string, Code>();
  let current: Code | null = null;
  for (const line of text.split(/\r?\n/)) {
    const kind = line[10];
    const description = clean(line.slice(11, 91));
    if (kind === '4' || kind === '8') {
      if (current) current.description = `${current.description} ${description}`;
      continue;
    }
    current = null;
    const terminated = line.slice(284, 292).trim() !== '';
    const code = kind === '3' ? line.slice(0, 5).trim() : kind === '7' ? line.slice(3, 5) : '';
    const set: CodeSet = kind === '3' ? 'hcpcs' : 'modifier';
    if (terminated || (set === 'hcpcs' && !AMBULANCE.test(code))) continue;
    const [parsed] = codeOf(set, code, description);
    if (!parsed) continue;
    current = parsed;
    records.set(`${set}\t${parsed.code}`, parsed);
  }
  return [...records.values()];
};

const X12_ROW =
  /<td class="code">([^<]+)<\/td><td class="description">([\s\S]*?)<span class="dates">/g;

export const parseX12Codes = (set: 'carc' | 'rarc', html: string): Code[] =>
  [...html.matchAll(X12_ROW)].flatMap(([, code = '', description = '']) =>
    codeOf(
      set,
      code,
      decode(description)
        .replace(/^\s*Alert:\s*/, '')
        .replace(/\s+Usage:[\s\S]*$/, '')
    )
  );

const POS_ROW = /<th scope="row">\s*(\d{2})\s*<\/th>\s*<td>([\s\S]*?)<\/td>/g;

export const parsePlacesOfService = (html: string): Code[] =>
  [...html.matchAll(POS_ROW)]
    .flatMap(([, code = '', name = '']) => codeOf('pos', code, decode(name)))
    .filter((c) => !/^unassigned$/i.test(c.description));

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export const mergeCodes = (...sources: Code[][]): Code[] => {
  const byKey = new Map<string, Code>();
  for (const c of sources.flat()) byKey.set(`${c.set}\t${c.code}`, c);
  return [...byKey.values()].sort((a, b) => compare(a.set, b.set) || compare(a.code, b.code));
};

export const toTsv = (codes: readonly Code[]) =>
  `${codes.map((c) => `${c.set}\t${c.code}\t${c.description}`).join('\n')}\n`;

export const readCodeSets = (gzipped: Buffer): Code[] =>
  gunzipSync(gzipped)
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      const [set = '', code = '', description = ''] = line.split('\t');
      return isCodeSet(set) ? [{ set, code, description }] : [];
    });

const CODE_BATCH = 5_000;

const buildUpsertCodes = (db: Kysely<Database>, codes: readonly Code[]) =>
  db
    .insertInto('codes')
    .values(codes.map((c) => ({ code_set: c.set, code: c.code, description: c.description })))
    .onConflict((oc) =>
      oc
        .columns(['code_set', 'code'])
        .doUpdateSet({ description: (eb) => eb.ref('excluded.description') })
    );

export const upsertCodeSets = async (db: Kysely<Database>, codes: readonly Code[]) => {
  for (let i = 0; i < codes.length; i += CODE_BATCH) {
    await buildUpsertCodes(db, codes.slice(i, i + CODE_BATCH)).execute();
  }
};
