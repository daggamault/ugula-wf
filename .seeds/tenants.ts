import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

type SeedTenantInput = {
  name: string;
  slug: string;
  sftpUsername: string;
  sftpPasswordHash: string;
};

const buildUpsertTenant = (db: Kysely<Database>, input: SeedTenantInput) =>
  db
    .insertInto('tenants')
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

export const upsertTenant = (db: Kysely<Database>, input: SeedTenantInput) =>
  buildUpsertTenant(db, input).executeTakeFirstOrThrow();
