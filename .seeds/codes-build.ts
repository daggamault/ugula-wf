import { writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import {
  CARC_URL,
  HCPCS_URL,
  ICD10CM_URL,
  ICD10CM_YEAR,
  mergeCodes,
  POS_URL,
  parseHcpcs,
  parseIcd10cm,
  parsePlacesOfService,
  parseX12Codes,
  RARC_URL,
  toTsv
} from './codes.ts';
import { download, unzipTexts } from './zip.ts';

export const CODE_SETS_FILE = new URL('./data/codes.tsv.gz', import.meta.url);

const page = async (url: string) => (await download(url)).toString('utf8');

const required = <T>(name: string, rows: T[]) => {
  if (!rows.length) throw new Error(`No ${name} codes found`);
  return rows;
};

const buildCodes = async () => {
  const icd = unzipTexts(await download(ICD10CM_URL), (n) =>
    n.endsWith(`icd10cm_codes_${ICD10CM_YEAR}.txt`)
  );
  const hcpcs = unzipTexts(await download(HCPCS_URL), (n) => /_ANWEB_\d+\.txt$/.test(n));
  return mergeCodes(
    required('ICD-10-CM', icd.flatMap(parseIcd10cm)),
    required('HCPCS', hcpcs.flatMap(parseHcpcs)),
    required('CARC', parseX12Codes('carc', await page(CARC_URL))),
    required('RARC', parseX12Codes('rarc', await page(RARC_URL))),
    required('place of service', parsePlacesOfService(await page(POS_URL)))
  );
};

if (import.meta.main) {
  const codes = await buildCodes();
  await writeFile(CODE_SETS_FILE, gzipSync(toTsv(codes), { level: 9 }));
  const counts = Object.entries(Object.groupBy(codes, (c) => c.set)).map(
    ([set, rows]) => `${rows?.length ?? 0} ${set}`
  );
  process.stdout.write(`Wrote ${codes.length} codes: ${counts.join(', ')}\n`);
}
