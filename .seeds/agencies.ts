import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

type SeedAgencyInput = {
  name: string;
  slug: string;
  sftpUsername: string;
  sftpPasswordHash: string;
};

const buildUpsertAgency = (db: Kysely<Database>, input: SeedAgencyInput) =>
  db
    .insertInto('agencies')
    .values({
      name: input.name,
      slug: input.slug,
      sftp_username: input.sftpUsername,
      sftp_password_hash: input.sftpPasswordHash,
      is_active: true
    })
    .onConflict((oc) =>
      oc.column('slug').doUpdateSet({
        name: input.name,
        sftp_username: input.sftpUsername,
        sftp_password_hash: input.sftpPasswordHash,
        is_active: true,
        updated_at: sql`now()`
      })
    )
    .returning('id');

export const upsertAgency = (db: Kysely<Database>, input: SeedAgencyInput) =>
  buildUpsertAgency(db, input).executeTakeFirstOrThrow();
