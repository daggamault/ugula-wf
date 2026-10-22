import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

export type SeedUserInput = {
  tenantId: string;
  email: string;
  passwordHash: string;
};

export const buildUpsertUser = (db: Kysely<Database>, input: SeedUserInput) =>
  db
    .insertInto('users')
    .values({
      tenant_id: input.tenantId,
      email: input.email,
      password_hash: input.passwordHash,
      is_active: true
    })
    .onConflict((oc) =>
      oc.column('email').doUpdateSet({
        tenant_id: input.tenantId,
        password_hash: input.passwordHash,
        is_active: true,
        updated_at: sql`now()`
      })
    )
    .returning('id');

export const upsertUser = (db: Kysely<Database>, input: SeedUserInput) =>
  buildUpsertUser(db, input).executeTakeFirstOrThrow();
