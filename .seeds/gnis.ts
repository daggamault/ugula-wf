import { gunzipSync } from 'node:zlib';
import { usState } from '@ugula/billing';
import type { Database } from '@ugula/db';
import type { Kysely } from 'kysely';

export type Place = { id: number; name: string; state: string };

export const GNIS_BASE = 'https://prd-tnm.s3.amazonaws.com/StagedProducts/GeographicNames';

export const POPULATED_PLACES_URL = `${GNIS_BASE}/Topical/PopulatedPlaces_National_Text.zip`;

export const FEDERAL_CODES_LIST_URL =
  'https://prd-tnm.s3.amazonaws.com/?prefix=StagedProducts/GeographicNames/FederalCodes/';

export const federalCodesUrl = (file: string) => `${GNIS_BASE}/FederalCodes/${file}`;

export const federalCodeFiles = (listing: string) => [
  ...new Set(listing.match(/FedCodes_[A-Z]{2}_Text\.zip/g) ?? [])
];

const PREFIX =
  /^(?:City of the Village of|City and Borough of|City and County of|Charter Township of|Metro Township of|Unified Government of|Metropolitan Government of|Consolidated Government of|Municipality of|Township of|Plantation of|Borough of|Village of|City of|Town of)\s+/;

export const placeName = (raw: string) =>
  raw
    .replace(/\s*\(historical\)$/, '')
    .replace(PREFIX, '')
    .replace(/\s+Census Designated Place$/, '')
    .trim();

const rowsOf = (text: string) => {
  const [head = '', ...lines] = text.replace(/^﻿/, '').split(/\r?\n/);
  const columns = head.split('|');
  return lines
    .filter((l) => l.trim())
    .map((l) => {
      const cells = l.split('|');
      return Object.fromEntries(columns.map((c, i) => [c, cells[i] ?? '']));
    });
};

const placeOf = (r: Record<string, string>): Place[] => {
  const id = Number(r.feature_id);
  const state = usState(r.state_numeric);
  const name = placeName(r.feature_name ?? '');
  return Number.isInteger(id) && id > 0 && state && name ? [{ id, name, state }] : [];
};

export const parsePopulatedPlaces = (text: string): Place[] =>
  rowsOf(text)
    .filter((r) => r.feature_class === 'Populated Place')
    .flatMap(placeOf);

export const parseFederalCodes = (text: string): Place[] =>
  rowsOf(text)
    .filter(
      (r) =>
        r.feature_class === 'Census' ||
        r.feature_class === 'Populated Place' ||
        (r.feature_class === 'Civil' && /^[CT]/.test(r.census_class_code ?? ''))
    )
    .flatMap(placeOf);

export const mergePlaces = (...sources: Place[][]): Place[] => {
  const byId = new Map<number, Place>();
  for (const p of sources.flat()) if (!byId.has(p.id)) byId.set(p.id, p);
  return [...byId.values()].sort((a, b) => a.id - b.id);
};

export const toTsv = (places: readonly Place[]) =>
  `${places.map((p) => `${p.id}\t${p.name}\t${p.state}`).join('\n')}\n`;

export const fromTsv = (text: string): Place[] =>
  text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [id = '', name = '', state = ''] = line.split('\t');
      return { id: Number(id), name, state };
    });

export const readPlaces = (gzipped: Buffer) => fromTsv(gunzipSync(gzipped).toString('utf8'));

export const PLACE_BATCH = 5_000;

export const buildUpsertPlaces = (db: Kysely<Database>, places: readonly Place[]) =>
  db
    .insertInto('gnis_places')
    .values(places.map((p) => ({ id: p.id, name: p.name, state: p.state })))
    .onConflict((oc) =>
      oc.column('id').doUpdateSet({
        name: (eb) => eb.ref('excluded.name'),
        state: (eb) => eb.ref('excluded.state')
      })
    );

export const upsertPlaces = async (db: Kysely<Database>, places: readonly Place[]) => {
  for (let i = 0; i < places.length; i += PLACE_BATCH) {
    await buildUpsertPlaces(db, places.slice(i, i + PLACE_BATCH)).execute();
  }
};
