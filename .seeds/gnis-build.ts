import { writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import {
  FEDERAL_CODES_LIST_URL,
  federalCodeFiles,
  federalCodesUrl,
  mergePlaces,
  type Place,
  POPULATED_PLACES_URL,
  parseFederalCodes,
  parsePopulatedPlaces,
  toTsv,
  unzipTexts
} from './gnis.ts';

export const PLACES_FILE = new URL('./data/gnis-places.tsv.gz', import.meta.url);

const isText = (name: string) => name.endsWith('.txt');

export const buildPlaces = async (download: (url: string) => Promise<Buffer>) => {
  const listing = (await download(FEDERAL_CODES_LIST_URL)).toString('utf8');
  const files = federalCodeFiles(listing);
  if (!files.length) throw new Error('No GNIS federal codes files found');
  const federal: Place[][] = [];
  for (const file of files) {
    federal.push(
      unzipTexts(await download(federalCodesUrl(file)), isText).flatMap(parseFederalCodes)
    );
  }
  const populated = unzipTexts(await download(POPULATED_PLACES_URL), isText).flatMap(
    parsePopulatedPlaces
  );
  return mergePlaces(populated, ...federal);
};

const download = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
};

if (import.meta.main) {
  const places = await buildPlaces(download);
  await writeFile(PLACES_FILE, gzipSync(toTsv(places), { level: 9 }));
  process.stdout.write(`Wrote ${places.length} GNIS places\n`);
}
