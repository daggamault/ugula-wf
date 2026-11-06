import { gunzipSync } from 'node:zlib';
import type { Database } from '@ugula/db';
import type { Kysely } from 'kysely';

type Place = { id: number; name: string };

export const PLACES_FILE = new URL('./data/gnis-places.tsv.gz', import.meta.url);

export const readPlaces = (gzipped: Buffer): Place[] =>
  gunzipSync(gzipped)
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [id = '', name = ''] = line.split('\t');
      return { id: Number(id), name };
    });

const PLACE_BATCH = 5_000;

const buildUpsertPlaces = (db: Kysely<Database>, places: readonly Place[]) =>
  db
    .insertInto('gnis_places')
    .values(places.map((p) => ({ id: p.id, name: p.name })))
    .onConflict((oc) => oc.column('id').doUpdateSet({ name: (eb) => eb.ref('excluded.name') }));

export const upsertPlaces = async (db: Kysely<Database>, places: readonly Place[]) => {
  for (let i = 0; i < places.length; i += PLACE_BATCH) {
    await buildUpsertPlaces(db, places.slice(i, i + PLACE_BATCH)).execute();
  }
};
