import type { Database } from '@ugula/db';
import type { Kysely } from 'kysely';
import { BATCH, inBatches, tsvRows } from './tsv.ts';

type Place = { id: number; name: string };

export const PLACES_FILE = new URL('./data/gnis-places.tsv.gz', import.meta.url);

export const readPlaces = (gzipped: Buffer): Place[] =>
  tsvRows(gzipped).map(([id = '', name = '']) => ({ id: Number(id), name }));

export const replacePlaces = async (db: Kysely<Database>, places: readonly Place[]) => {
  await db.deleteFrom('gnis_places').execute();
  await inBatches(places, BATCH, (batch) =>
    db
      .insertInto('gnis_places')
      .values(batch.map((p) => ({ id: p.id, name: p.name })))
      .execute()
  );
};
