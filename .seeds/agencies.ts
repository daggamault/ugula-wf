import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

type SeedAgencyInput = {
  organizationId: string;
  name: string;
  slug: string;
  sftpUsername: string | null;
  sftpPasswordHash: string | null;
};

export const upsertOrganization = (db: Kysely<Database>, name: string) =>
  db
    .insertInto('organizations')
    .values({ name, is_active: true })
    .onConflict((oc) => oc.column('name').doUpdateSet({ is_active: true, updated_at: sql`now()` }))
    .returning('id')
    .executeTakeFirstOrThrow();

export const upsertAgency = (db: Kysely<Database>, input: SeedAgencyInput) =>
  db
    .insertInto('agencies')
    .values({
      organization_id: input.organizationId,
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
    .returning(['id', 'organization_id'])
    .executeTakeFirstOrThrow();
