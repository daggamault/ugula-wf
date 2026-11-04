import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

type SeedUserInput = {
  agencyId: string;
  email: string;
  passwordHash: string;
};

const buildUpsertUser = (db: Kysely<Database>, input: SeedUserInput) =>
  db
    .insertInto('users')
    .values({
      agency_id: input.agencyId,
      email: input.email,
      password_hash: input.passwordHash,
      is_active: true
    })
    .onConflict((oc) =>
      oc.expression(sql`lower(email)`).doUpdateSet({
        agency_id: input.agencyId,
        password_hash: input.passwordHash,
        is_active: true,
        updated_at: sql`now()`
      })
    )
    .returning('id');

export const upsertUser = (db: Kysely<Database>, input: SeedUserInput) =>
  buildUpsertUser(db, input).executeTakeFirstOrThrow();
