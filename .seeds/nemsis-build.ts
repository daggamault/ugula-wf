import { writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import {
  codesToTsv,
  type Dictionary,
  elementsToTsv,
  mergeDictionaries,
  NEMSIS_RELEASES,
  parseXsds,
  xsdZipUrl
} from './nemsis-dictionary.ts';
import { download, unzipTexts } from './zip.ts';

export const ELEMENTS_FILE = new URL('./data/nemsis-elements.tsv.gz', import.meta.url);
export const CODES_FILE = new URL('./data/nemsis-codes.tsv.gz', import.meta.url);

const isXsd = (name: string) => name.endsWith('.xsd');

const buildDictionary = async (download: (url: string) => Promise<Buffer>) => {
  const releases: Dictionary[] = [];
  for (const release of NEMSIS_RELEASES) {
    const xsds = unzipTexts(await download(xsdZipUrl(release)), isXsd);
    if (!xsds.length) throw new Error(`No XSDs in NEMSIS ${release}`);
    releases.push(parseXsds(xsds));
  }
  return mergeDictionaries(...releases);
};

if (import.meta.main) {
  const { elements, codes } = await buildDictionary(download);
  await writeFile(ELEMENTS_FILE, gzipSync(elementsToTsv(elements), { level: 9 }));
  await writeFile(CODES_FILE, gzipSync(codesToTsv(codes), { level: 9 }));
  process.stdout.write(`Wrote ${elements.length} NEMSIS elements and ${codes.length} codes\n`);
}
